// 매매 방법 비교: scripts/backtest.py가 실제로 돌려 만든 data/backtest.json을 그대로 보여 준다(화면에서 다시 계산하지 않음).

const $ = (id) => document.getElementById(id);
const won = (n) => Math.round(n).toLocaleString("ko-KR");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pct = (n) => `${n > 0 ? "+" : ""}${n.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`;
const tone = (n) => (n > 0 ? "up" : n < 0 ? "down" : "");

// 1억 단위로 읽기 쉽게: 765,913,342 → "+7억 6,591만"
function money(n) {
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  const man = Math.round(Math.abs(n) / 10000);
  const eok = Math.floor(man / 10000), rest = man % 10000;
  return sign + (eok ? `${eok}억${rest ? ` ${rest.toLocaleString("ko-KR")}만` : ""}` : `${rest.toLocaleString("ko-KR")}만`) + "원";
}

let data;
let sel = { s: 0, m: 0 };
let chart, candle, markers;
let byDate = new Map();
let years = 0;

const { createChart, CandlestickSeries, createSeriesMarkers } = window.LightweightCharts;
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function chartColors() {
  return {
    layout: { background: { type: "solid", color: css("--paper") }, textColor: css("--muted"), fontFamily: css("--font") },
    grid: { vertLines: { color: css("--line") }, horzLines: { color: css("--line") } },
    rightPriceScale: { borderColor: css("--line") },
    timeScale: { borderColor: css("--line") },
  };
}

function candleColors() {
  const up = css("--up"), down = css("--down");
  return { upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down };
}

function renderTable() {
  const html = [];
  data.stocks.forEach((st, s) => {
    html.push(`<tr class="bt-group"><th colspan="7">${esc(st.name)} <small>${st.code}</small></th></tr>`);
    st.results.forEach((r) => {
      const label = esc(data.methods[r.method].label);
      const on = s === sel.s && r.method === sel.m;
      if (r.error) {
        html.push(`<tr class="bt-err"><td>${label}</td><td colspan="6">안 돌아갔어요: ${esc(r.error)}</td></tr>`);
        return;
      }
      const best = r.method === st.best ? ` <span class="bt-best">최고</span>` : "";
      html.push(`<tr class="bt-row" data-s="${s}" data-m="${r.method}" tabindex="0" aria-selected="${on}">
        <td>${label}${best}</td>
        <td class="num ${tone(r.ret)}"><b>${pct(r.ret)}</b></td>
        <td class="num ${tone(r.profit)}">${money(r.profit)}</td>
        <td class="num down">${pct(r.mdd)}</td>
        <td class="num">${r.trades}번</td>
        <td class="num">${r.wins}번</td>
        <td class="num">${r.firstBuy ?? "-"}</td></tr>`);
    });
  });
  $("rows").innerHTML = html.join("");
}

function renderChart() {
  const st = data.stocks[sel.s];
  const r = st.results.find((x) => x.method === sel.m);
  const last = st.prices[st.prices.length - 1][0];
  $("chartTitle").innerHTML = `${esc(st.name)} · ${esc(data.methods[sel.m].label)} <span class="${tone(r.ret)}">${pct(r.ret)}</span>`;

  candle.setData(st.prices.map(([time, open, high, low, close]) => ({ time, open, high, low, close })));

  // 거래가 많으면 글자를 빼서 화살표만 남긴다.
  const words = r.fills.length <= 30;
  const up = css("--up"), down = css("--down");
  byDate = new Map();
  const add = (date, item) => byDate.set(date, [...(byDate.get(date) || []), item]);
  const list = [];
  r.fills.forEach((f, n) => {
    const [inDay, inPx, outDay, outPx, ret] = f;
    const open = n === r.fills.length - 1 && outDay === last; // 마지막 날까지 들고 있던 거래
    list.push({ time: inDay, position: "belowBar", shape: "arrowUp", color: up, text: words ? "산" : "" });
    list.push({ time: outDay, position: "aboveBar", shape: "arrowDown", color: down, text: words ? (open ? "정리" : "팜") : "" });
    const item = { n: n + 1, inDay, inPx, outDay, outPx, ret, open };
    add(inDay, item);
    if (outDay !== inDay) add(outDay, item);
  });
  list.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  markers.setMarkers(list);

  $("fills").innerHTML = `<thead><tr><th>#</th><th>산 날</th><th>산 값</th><th>판 날</th><th>판 값</th><th>수익률</th></tr></thead><tbody>` +
    r.fills.map(([a, b, c, d, e], n) => `<tr><td>${n + 1}</td><td>${a}</td><td class="num">${won(b)}</td>
      <td>${c}${n === r.fills.length - 1 && c === last ? " (마지막 날 정리)" : ""}</td><td class="num">${won(d)}</td>
      <td class="num ${tone(e)}">${pct(e)}</td></tr>`).join("") + "</tbody>";
  $("fillsBox").querySelector("summary").textContent = `거래 내역 보기 (${r.fills.length}번)`;

  $("tip").hidden = true;
  setRange(years);
}

function setRange(y) {
  years = y;
  const prices = data.stocks[sel.s].prices;
  const last = prices[prices.length - 1][0];
  if (!y) { chart.timeScale().fitContent(); return; }
  const from = new Date(last);
  from.setFullYear(from.getFullYear() - y);
  chart.timeScale().setVisibleRange({ from: from.toISOString().slice(0, 10), to: last });
}

function showTip(items, point) {
  const tip = $("tip");
  if (!items?.length) { tip.hidden = true; return; }
  tip.innerHTML = items.map((t) => `<div class="tip-item" style="--sig:${css(t.ret >= 0 ? "--up" : "--down")}">
      <p><b>${t.n}번째 거래</b> · <b class="${tone(t.ret)}">${pct(t.ret)}</b></p>
      <p>산 날 ${t.inDay} · ${won(t.inPx)}원</p>
      <p>${t.open ? "마지막 날 정리" : "판 날"} ${t.outDay} · ${won(t.outPx)}원</p></div>`).join("") +
    `<button type="button" class="tip-x" aria-label="닫기">×</button>`;
  tip.hidden = false;
  const box = $("chartBox").getBoundingClientRect();
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = `${Math.min(Math.max(point.x - w / 2, 4), box.width - w - 4)}px`;
  tip.style.top = `${Math.max(point.y - h - 14 >= 4 ? point.y - h - 14 : Math.min(point.y + 18, box.height - h - 4), 4)}px`;
}

function select(s, m) {
  sel = { s, m };
  for (const tr of $("rows").querySelectorAll(".bt-row")) {
    tr.setAttribute("aria-selected", Number(tr.dataset.s) === s && Number(tr.dataset.m) === m);
  }
  renderChart();
}

async function main() {
  data = await (await fetch("data/backtest.json")).json();

  $("source").innerHTML =
    `<b>${data.from} ~ ${data.to}</b> 일봉 · 처음 돈 <b>${money(data.cash).slice(1)}</b> · 수수료+세금 살 때·팔 때 각 ${data.fee * 100}% · ` +
    `종가로 신호를 보고 다음 날 시가에 사고팔기 · ${esc(data.engine)}로 돌린 결과`;
  if (data.problems.length) {
    $("problems").hidden = false;
    $("problems").textContent = `안 돌아간 것: ${data.problems.join(" / ")}`;
  }

  $("ruleList").innerHTML = data.methods.map((m) => `<li><b>${esc(m.label)}</b> — ${esc(m.rule)}</li>`).join("");
  const dropped = data.stocks.filter((s) => s.droppedZeroDays).map((s) => `${s.name} ${s.droppedZeroDays}일`).join(", ");
  $("conditions").innerHTML = [
    "세 종목 모두 FinanceDataReader가 기본으로 주는 기간 그대로 썼어요.",
    "신호는 그날 종가로 보고, 실제로 사고파는 건 다음 날 시가예요.",
    "한 번에 가진 돈을 다 써서 사고(정수 주), 팔 때는 다 팔아요.",
    "마지막 날까지 들고 있던 거래는 backtesting.py가 마지막 날 <b>시가</b>로 정리해서 셈해요.",
    "줄·선이 다 계산될 만큼 지난 주가가 쌓인 뒤부터 신호를 봐요(⑤·⑥은 2016년부터 사기 시작).",
    dropped ? `액면분할로 거래가 멈춰 가격이 0으로 들어 있던 날은 뺐어요 (${esc(dropped)}).` : "",
  ].filter(Boolean).map((t) => `<li>${t}</li>`).join("");

  sel = { s: 0, m: data.stocks[0].best ?? 0 };
  renderTable();

  chart = createChart($("chartBox"), {
    autoSize: true,
    ...chartColors(),
    localization: { locale: "ko-KR", priceFormatter: won, dateFormat: "yyyy-MM-dd" },
    crosshair: { mode: 0 },
  });
  candle = chart.addSeries(CandlestickSeries, { ...candleColors(), priceLineVisible: false });
  markers = createSeriesMarkers(candle, []);
  requestAnimationFrame(renderChart); // 차트 크기가 정해진 뒤에 그린다.

  chart.subscribeClick((p) => {
    if (!p.point || !p.time) { $("tip").hidden = true; return; }
    showTip(byDate.get(p.time), p.point);
  });
  $("tip").addEventListener("click", (e) => { if (e.target.closest(".tip-x")) $("tip").hidden = true; });

  const pick = (e) => {
    const tr = e.target.closest(".bt-row");
    if (!tr) return;
    select(Number(tr.dataset.s), Number(tr.dataset.m));
    $("chartTitle").scrollIntoView({ behavior: "smooth", block: "start" });
  };
  $("rows").addEventListener("click", pick);
  $("rows").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(e); } });

  $("ranges").addEventListener("click", (e) => {
    const b = e.target.closest("[data-years]");
    if (!b) return;
    for (const x of $("ranges").children) x.setAttribute("aria-pressed", x === b);
    setRange(Number(b.dataset.years));
  });

  window.addEventListener("themechange", () => {
    chart.applyOptions(chartColors());
    candle.applyOptions(candleColors());
    renderChart();
  });
}

// ---------- 디자인 고르기 (다른 페이지와 같은 저장값을 쓴다) ----------
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

main().catch((e) => { $("source").textContent = `결과를 불러오지 못했어요. (${e.message})`; });
