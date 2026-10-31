import { movingAverage, goldenCrosses, yearHighBreaks, doubleBottoms } from "./signals.js";

const $ = (id) => document.getElementById(id);
const won = (n) => Math.round(n).toLocaleString("ko-KR");
const DAY = ["일", "월", "화", "수", "목", "금", "토"];
const dayName = (date) => `${date}(${DAY[new Date(date).getDay()]})`;

// 신호 종류. 색은 상승 빨강·하락 파랑 봉과 헷갈리지 않는 색으로 고정.
const KINDS = [
  { key: "gc", sym: "▲", label: "골든크로스", color: "#f08c00", position: "belowBar", shape: "arrowUp", text: "" },
  { key: "hi", sym: "★", label: "1년 최고가 돌파", color: "#d4a000", position: "aboveBar", shape: "circle", text: "★", size: 0 },
  { key: "w", sym: "W", label: "쌍바닥 완성", color: "#8b5cf6", position: "belowBar", shape: "square", text: "W" },
];
const on = { gc: true, hi: true, w: true };

let rows = [];
let signals = [];   // {kind, date, html}
let chart, candle, ma5Line, ma20Line, volume, markers;

const { createChart, CandlestickSeries, LineSeries, HistogramSeries, createSeriesMarkers } = window.LightweightCharts;

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function chartColors() {
  const paper = css("--paper");
  return {
    layout: { background: { type: "solid", color: paper }, textColor: css("--muted"), fontFamily: css("--font") },
    grid: { vertLines: { color: css("--line") }, horzLines: { color: css("--line") } },
    rightPriceScale: { borderColor: css("--line") },
    timeScale: { borderColor: css("--line") },
  };
}

function candleColors() {
  const up = css("--up"), down = css("--down");
  return { upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down };
}

function line(label, date, rest) {
  return `<p><b>${label}</b> · ${dayName(date)}</p><p>${rest}</p>`;
}

function buildSignals(all, showFrom) {
  const start = all.findIndex((r) => r.date >= showFrom);
  const ma5 = movingAverage(all, 5);
  const ma20 = movingAverage(all, 20);
  const shown = (x) => x.i >= start;
  const out = [];

  for (const g of goldenCrosses(all, ma5, ma20).filter(shown)) {
    const r = all[g.i];
    out.push({ kind: "gc", date: r.date,
      html: line("▲ 골든크로스", r.date, `종가 <b>${won(r.close)}원</b> · 5일선 ${won(g.ma5)} · 20일선 ${won(g.ma20)}`) });
  }

  const hi = yearHighBreaks(all);
  for (const h of hi.marks.filter(shown)) {
    const r = all[h.i];
    out.push({ kind: "hi", date: r.date,
      html: line("★ 1년 최고가 돌파", r.date, `고가 <b>${won(r.high)}원</b> (직전 1년 최고 ${won(h.prevHigh)}원) · 종가 ${won(r.close)}원`) });
  }

  for (const w of doubleBottoms(all).filter(shown)) {
    const r = all[w.i], a = all[w.first], b = all[w.second];
    out.push({ kind: "w", date: r.date,
      html: line("W 쌍바닥 완성", r.date,
        `종가 <b>${won(r.close)}원</b> (목선 ${won(w.neck)}원 돌파)<br>` +
        `첫 바닥 ${a.date} ${won(a.low)}원 · 둘째 바닥 ${b.date} ${won(b.low)}원`) });
  }

  return { list: out, start, ma5, ma20, highDays: hi.hitDays.filter((i) => i >= start).length };
}

function renderToggles() {
  $("toggles").innerHTML = KINDS.map((k) => {
    const n = signals.filter((s) => s.kind === k.key).length;
    return `<button type="button" class="sig-chip" data-kind="${k.key}" aria-pressed="${on[k.key]}" style="--sig:${k.color}">
      <span class="sym">${k.sym}</span><span class="lbl">${k.label}</span><b>${n}번</b></button>`;
  }).join("");
}

function renderMarkers() {
  const byKind = Object.fromEntries(KINDS.map((k) => [k.key, k]));
  const list = signals
    .filter((s) => on[s.kind])
    .map((s) => {
      const k = byKind[s.kind];
      return { id: `${s.kind}:${s.date}`, time: s.date, position: k.position, shape: k.shape, color: k.color, text: k.text, size: k.size ?? 1 };
    })
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  markers.setMarkers(list);
}

function showTip(hits, point) {
  const tip = $("tip");
  if (!hits.length) { tip.hidden = true; return; }
  tip.innerHTML = hits.map((s) => `<div class="tip-item" style="--sig:${KINDS.find((k) => k.key === s.kind).color}">${s.html}</div>`).join("") +
    `<button type="button" class="tip-x" aria-label="닫기">×</button>`;
  tip.hidden = false;
  const box = $("chartBox").getBoundingClientRect();
  const w = tip.offsetWidth, h = tip.offsetHeight;
  const x = Math.min(Math.max(point.x - w / 2, 4), box.width - w - 4);
  const y = point.y - h - 14 >= 4 ? point.y - h - 14 : Math.min(point.y + 18, box.height - h - 4);
  tip.style.left = `${x}px`;
  tip.style.top = `${Math.max(y, 4)}px`;
}

function setRange(months) {
  const last = rows[rows.length - 1].date;
  if (months >= 60) { chart.timeScale().fitContent(); return; }
  const from = new Date(last);
  from.setMonth(from.getMonth() - months);
  chart.timeScale().setVisibleRange({ from: from.toISOString().slice(0, 10), to: last });
}

async function main() {
  const d = await (await fetch("data/005930.json")).json();
  const all = d.rows.map(([date, open, high, low, close, volume]) => ({ date, open, high, low, close, volume }));
  const built = buildSignals(all, d.showFrom);
  signals = built.list;
  rows = all.slice(built.start);

  const last = rows[rows.length - 1];
  $("source").innerHTML =
    `<b>${d.name}(${d.code})</b> ${rows[0].date} ~ <b>${last.date}</b> 일봉 ${rows.length.toLocaleString()}일 · 출처: ` +
    `<a href="https://github.com/FinanceData/FinanceDataReader" target="_blank" rel="noopener">${d.source}</a>`;
  $("starAll").textContent = `(이 기간에 1년 최고가를 넘긴 날은 모두 ${built.highDays}일이고, 그중 처음 다시 넘긴 날만 ★로 찍었어요.)`;

  chart = createChart($("chartBox"), {
    autoSize: true,
    ...chartColors(),
    localization: { locale: "ko-KR", priceFormatter: won, dateFormat: "yyyy-MM-dd" },
    crosshair: { mode: 0 },
  });
  candle = chart.addSeries(CandlestickSeries, { ...candleColors(), priceLineVisible: false });
  candle.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.08 } });
  candle.setData(rows.map(({ date, open, high, low, close }) => ({ time: date, open, high, low, close })));

  const ma = (arr) => rows.map((r, n) => ({ time: r.date, value: arr[built.start + n] }));
  const lineOpts = { lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
  ma5Line = chart.addSeries(LineSeries, { ...lineOpts, color: "#e64980" });
  ma20Line = chart.addSeries(LineSeries, { ...lineOpts, color: "#2b8a3e" });
  ma5Line.setData(ma(built.ma5));
  ma20Line.setData(ma(built.ma20));

  // 거래량은 아래 칸에 따로 그린다.
  volume = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false }, 1);
  chart.panes()[1].setHeight(70);
  const paintVolume = () => {
    const up = css("--up"), down = css("--down");
    volume.setData(rows.map((r, n) => ({
      time: r.date, value: r.volume,
      color: (r.close >= (n ? rows[n - 1].close : r.open) ? up : down) + "66",
    })));
  };
  paintVolume();

  markers = createSeriesMarkers(candle, []);
  renderToggles();
  renderMarkers();
  requestAnimationFrame(() => setRange(12)); // 차트 크기가 정해진 뒤에 1년으로 맞춘다.

  // 표시(또는 표시가 있는 날의 봉)를 누르면 그날 신호를 띄운다.
  chart.subscribeClick((p) => {
    if (!p.point || !p.time) { $("tip").hidden = true; return; }
    const id = typeof p.hoveredObjectId === "string" ? p.hoveredObjectId : null;
    const date = id ? id.split(":")[1] : p.time;
    showTip(signals.filter((s) => s.date === date && on[s.kind]), p.point);
  });
  $("tip").addEventListener("click", (e) => { if (e.target.closest(".tip-x")) $("tip").hidden = true; });

  $("toggles").addEventListener("click", (e) => {
    const b = e.target.closest("[data-kind]");
    if (!b) return;
    on[b.dataset.kind] = !on[b.dataset.kind];
    b.setAttribute("aria-pressed", on[b.dataset.kind]);
    $("tip").hidden = true;
    renderMarkers();
  });

  $("ranges").addEventListener("click", (e) => {
    const b = e.target.closest("[data-months]");
    if (!b) return;
    for (const x of $("ranges").children) x.setAttribute("aria-pressed", x === b);
    setRange(Number(b.dataset.months));
  });

  // 디자인을 바꾸면 차트 색만 다시 칠한다.
  window.addEventListener("themechange", () => {
    chart.applyOptions(chartColors());
    candle.applyOptions(candleColors());
    paintVolume();
  });
}

// ---------- 디자인 고르기 (첫 페이지와 같은 저장값을 쓴다) ----------
function showTheme(t) {
  if (t === "base") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  for (const b of $("themes").children) b.setAttribute("aria-pressed", b.dataset.theme === t);
}
showTheme(document.documentElement.dataset.theme || "base");
$("themes").addEventListener("click", (ev) => {
  const t = ev.target.closest("button")?.dataset.theme;
  if (!t) return;
  showTheme(t);
  try { localStorage.setItem("ohaeng-theme", t); } catch {}
  window.dispatchEvent(new Event("themechange"));
});

main().catch((e) => { $("source").textContent = `차트를 그리지 못했어요. (${e.message})`; });
