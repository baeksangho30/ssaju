import { calculateSaju } from "./vendor/ssaju.mjs";
import { ELEMENTS, RULES, elementOf } from "./mapping.js";

const RS_CUT = 80;
const $ = (id) => document.getElementById(id);
const EL = Object.fromEntries(ELEMENTS.map((e) => [e.key, e]));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

let data = null;
const dataReady = fetch("data/kospi-rs.json")
  .then((r) => r.json())
  .then((d) => {
    data = d;
    for (const s of d.stocks) s.element = elementOf(s.industry)?.element ?? null;
    $("footSrc").href = d.sourceUrl;
  });

// ---------- 입력 ----------

for (let m = 1; m <= 12; m++) $("m").add(new Option(m, m));
function fillDays() {
  const keep = $("d").value;
  const lunar = calMode() === "lunar";
  const y = +$("y").value || 2000, m = +$("m").value || 1;
  const max = lunar ? 30 : new Date(y, m, 0).getDate();
  $("d").length = 0;
  for (let d = 1; d <= max; d++) $("d").add(new Option(d, d));
  if (keep && keep <= max) $("d").value = keep;
}
const calMode = () => document.querySelector("input[name=cal]:checked").value;
document.querySelectorAll("input[name=cal]").forEach((r) =>
  r.addEventListener("change", () => {
    document.querySelector(".leap").hidden = calMode() !== "lunar";
    fillDays();
  })
);
$("y").addEventListener("input", fillDays);
$("m").addEventListener("change", fillDays);
fillDays();

function readForm() {
  const [hh, mm] = $("t").value.split(":").map(Number);
  return {
    name: $("name").value.trim(),
    y: +$("y").value, m: +$("m").value, d: +$("d").value,
    cal: calMode(),
    leap: calMode() === "lunar" && $("leap").checked,
    hh, mm,
  };
}

function writeForm(f) {
  $("name").value = f.name;
  document.querySelector(`input[name=cal][value=${f.cal}]`).checked = true;
  document.querySelector(".leap").hidden = f.cal !== "lunar";
  $("leap").checked = f.leap;
  $("y").value = f.y;
  $("m").value = f.m;
  fillDays();
  $("d").value = f.d;
  $("t").value = `${String(f.hh).padStart(2, "0")}:${String(f.mm).padStart(2, "0")}`;
}

function toQuery(f) {
  const p = new URLSearchParams({
    name: f.name, date: `${f.y}-${f.m}-${f.d}`, cal: f.cal,
    time: `${String(f.hh).padStart(2, "0")}${String(f.mm).padStart(2, "0")}`,
  });
  if (f.leap) p.set("leap", "1");
  return p.toString();
}

function fromQuery() {
  const p = new URLSearchParams(location.search);
  if (!p.get("date") || !p.get("time")) return null;
  const [y, m, d] = p.get("date").split("-").map(Number);
  const t = p.get("time");
  return {
    name: p.get("name") || "", y, m, d,
    cal: p.get("cal") === "lunar" ? "lunar" : "solar",
    leap: p.get("leap") === "1",
    hh: +t.slice(0, 2), mm: +t.slice(2, 4),
  };
}

$("form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = readForm();
  if (await run(f)) {
    history.replaceState(null, "", `?${toQuery(f)}`);
    $("result").scrollIntoView({ behavior: "smooth" });
  }
});

// ---------- 계산 ----------

async function run(f) {
  $("err").hidden = true;
  let saju;
  try {
    if (!(f.y >= 1900 && f.y <= 2049)) throw new Error("연도는 1900~2049 사이로 넣어 주세요.");
    saju = calculateSaju({
      year: f.y, month: f.m, day: f.d, hour: f.hh, minute: f.mm,
      calendar: f.cal, leap: f.leap,
    });
  } catch (e) {
    $("err").textContent = `날짜를 다시 확인해 주세요. (${e.message})`;
    $("err").hidden = false;
    return false;
  }
  await dataReady;

  const counts = saju.fiveElements;
  const min = Math.min(...ELEMENTS.map((e) => counts[e.key]));
  const lacking = ELEMENTS.filter((e) => counts[e.key] === min).map((e) => e.key);
  const picks = data.stocks
    .filter((s) => s.rs > RS_CUT && lacking.includes(s.element))
    .sort((a, b) => b.rs - a.rs || b.ret1y - a.ret1y);

  renderFun(f, saju, counts, lacking);
  renderReal(lacking, picks);
  renderBrag(f, lacking, picks.slice(0, 3));
  $("result").hidden = false;
  lastForm = f;
  return true;
}
let lastForm = null;

// ---------- 재미 구역 ----------

function renderFun(f, saju, counts, lacking) {
  $("who").textContent = f.name || "나";
  const s = saju.solar;
  const time = `${String(f.hh).padStart(2, "0")}:${String(f.mm).padStart(2, "0")}`;
  $("birth").textContent = f.cal === "lunar"
    ? `음력 ${f.y}년 ${f.m}월 ${f.d}일${f.leap ? "(윤달)" : ""} ${time} · 양력으로 ${s.year}년 ${s.month}월 ${s.day}일`
    : `양력 ${f.y}년 ${f.m}월 ${f.d}일 ${time}`;

  const order = [["hour", "시"], ["day", "일"], ["month", "월"], ["year", "연"]];
  $("pillars").innerHTML = order.map(([k, label]) => {
    const p = saju.pillarDetails[k];
    const cell = (ch, ko, el) =>
      `<div class="gz" style="--c:${EL[el].color}"><b>${ch}</b><small>${ko} · ${el}</small></div>`;
    return `<div class="pillar"><span>${label}주</span>${cell(p.stem, p.stemKo, p.element.stem)}${cell(p.branch, p.branchKo, p.element.branch)}</div>`;
  }).join("");

  const max = Math.max(...Object.values(counts), 1);
  $("bars").innerHTML = ELEMENTS.map((e) => {
    const n = counts[e.key];
    const low = lacking.includes(e.key);
    return `<div class="bar ${low ? "low" : ""}" style="--c:${e.color}">
      <span class="lbl"><b>${e.hanja}</b>${e.key}</span>
      <span class="track"><span class="fill" style="width:${(n / max) * 100}%"></span></span>
      <span class="n">${n}개</span>
    </div>`;
  }).join("");

  const names = lacking.map((k) => `<b style="color:${EL[k].color}">${EL[k].hanja}(${k})</b>`).join(", ");
  const n = counts[lacking[0]];
  $("lack").innerHTML = `<p>여덟 글자 중 ${names} 기운이 <b>${n}개</b>로 가장 적어요.${lacking.length > 1 ? " 똑같이 적은 오행은 모두 채워 볼게요." : ""}</p>
    <p class="idea">${lacking.map((k) => `${EL[k].hanja} ${EL[k].idea}`).join("<br>")}</p>`;

  renderRules(lacking);
}

function renderRules(lacking) {
  const inds = {};
  for (const s of data.stocks) {
    if (!s.element) continue;
    (inds[s.element] ??= new Set()).add(s.industry);
  }
  $("ruleList").innerHTML = ELEMENTS.map((e) => {
    const words = RULES.filter(([, el]) => el === e.key).map(([w]) => w);
    const list = [...(inds[e.key] ?? [])].sort();
    return `<div class="rule ${lacking.includes(e.key) ? "on" : ""}" style="--c:${e.color}">
      <h3>${e.hanja} ${e.key} <small>${e.idea}</small></h3>
      <p class="words">찾는 낱말: ${words.map((w) => `<code>${esc(w)}</code>`).join(" ")}</p>
      <p class="inds">해당 업종 ${list.length}개: ${list.map(esc).join(" · ")}</p>
    </div>`;
  }).join("");
  $("rules").open = false;
}

// ---------- 실제 숫자 구역 ----------

function asOfText(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

// 1년 종가를 네모 안에 들어가는 작은 선 그래프(SVG)로 그린다.
// 색은 카드에 적힌 1년 수익률(점수 사이트 값)을 따른다: 플러스면 빨강, 마이너스면 파랑.
// 그래프 선(FinanceDataReader 종가)의 처음·끝과 방향이 다를 수 있지만, 카드 안에서 색과 숫자가 엇갈리지 않게 한다.
// 색은 그래프가 들어갈 곳(scope)의 --up / --down을 읽어 글자색으로 박는다. 그림 저장(html2canvas)은 SVG에 CSS를 적용하지 못하기 때문.
function sparkline(close, up, scope, w = 200, h = 56) {
  const lo = Math.min(...close), hi = Math.max(...close);
  const x = (i) => (i / (close.length - 1)) * w;
  const y = (v) => h - 3 - ((v - lo) / (hi - lo || 1)) * (h - 6);
  const pts = close.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const css = getComputedStyle(scope);
  const c = css.getPropertyValue(up ? "--up" : "--down").trim();
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none" aria-hidden="true"><polygon points="0,${h} ${pts} ${w},${h}" fill="${c}" fill-opacity="0.12"/><polyline points="${pts}" fill="none" stroke="${c}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}

const shortDate = (iso) => iso.slice(2).replaceAll("-", ".");

function renderReal(lacking, picks) {
  const label = lacking.map((k) => `${EL[k].hanja}(${k})`).join("·");
  $("realTitle").textContent = `${label} 업종 중 체력 점수 ${RS_CUT}점 넘는 코스피 종목 ${picks.length}개`;
  $("source").innerHTML = `<b>${asOfText(data.asOf)} 기준</b> 코스피 체력 점수(상대강도, RS) · 출처: <a href="${esc(data.sourceUrl)}" target="_blank" rel="noopener">${esc(data.sourceTitle)}</a><br>업종: FinanceDataReader KRX-DESC · 1년 주가 그래프: FinanceDataReader 종가`;

  $("cards").innerHTML = picks.length
    ? picks.map((s) => {
        const e = EL[s.element];
        const up = s.ret1y >= 0;
        return `<a class="card" href="https://dalinaum.github.io/rs/charts/${esc(s.code)}.html" target="_blank" rel="noopener" style="--c:${e.color}">
          <div class="card-top"><span class="nm">${esc(s.name)}</span><span class="cd">${esc(s.code)}</span></div>
          <div class="rs"><b>${s.rs}</b><span>점</span><i style="width:${s.rs}%"></i></div>
          <div class="ind"><span class="chip">${e.hanja}</span>${esc(s.industry)}</div>
          <figure class="chart">${sparkline(s.history.close, up, $("cards"))}
            <figcaption><span>${shortDate(s.history.from)}</span><span>1년 주가</span><span>${shortDate(s.history.to)}</span></figcaption></figure>
          <dl><div><dt>1년 수익률</dt><dd class="${up ? "up" : "down"}">${up ? "+" : ""}${s.ret1y.toFixed(1)}%</dd></div>
          <div><dt>종가</dt><dd>${s.close.toLocaleString("ko-KR")}원</dd></div></dl>
        </a>`;
      }).join("")
    : `<p class="empty">이번 점수표에는 ${label} 업종에서 ${RS_CUT}점을 넘는 종목이 없어요.</p>`;

  const noInd = data.stocks.filter((s) => !s.industry);
  const strongNoInd = noInd.filter((s) => s.rs > RS_CUT);
  $("realNote").innerHTML = `점수표 ${data.stocks.length}종목 중 KRX-DESC에서 업종을 못 찾은 ${noInd.length}종목은 빠졌어요${strongNoInd.length ? ` (그중 ${RS_CUT}점 넘는 종목: ${strongNoInd.map((s) => esc(s.name)).join(", ")})` : ""}. 우선주는 보통주의 업종을 따랐어요. 카드를 누르면 점수 사이트의 차트로 가요.`;
}

// ---------- 자랑 카드 ----------

function renderBrag(f, lacking, top) {
  const lackTxt = lacking.map((k) => `<span style="color:${EL[k].color}">${EL[k].hanja}</span>`).join("");
  const lackKo = lacking.join("·");
  $("brag").innerHTML = `
    <div class="brag-in" style="--c:${EL[lacking[0]].color}">
      <p class="b-name">${esc(f.name || "나")}님의 부족한 기운</p>
      <p class="b-el">${lackTxt}<small>${lackKo}</small></p>
      <p class="b-cap">채워 줄 힘센 종목 TOP 3</p>
      <ol>${top.length
        ? top.map((s, i) => `<li><span class="rk">${i + 1}</span><span class="bn">${esc(s.name)}</span><span class="bs">RS ${s.rs}</span>
            <span class="bc">${sparkline(s.history.close, s.ret1y >= 0, $("cards"), 300, 40)}<small>1년 ${s.ret1y >= 0 ? "+" : ""}${s.ret1y.toFixed(1)}%</small></span></li>`).join("")
        : `<li class="none">이번엔 80점 넘는 종목이 없어요</li>`}</ol>
      <p class="b-foot">사주는 재미로 · 체력 점수 ${asOfText(data.asOf)} 코스피 기준 · 투자 권유 아님</p>
    </div>`;
}

function toast(msg) {
  $("toast").textContent = msg;
  $("toast").hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => ($("toast").hidden = true), 2200);
}

$("save").addEventListener("click", async () => {
  if (!window.html2canvas) return toast("그림 저장 도구를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.");
  try {
    await document.fonts.ready;
    const canvas = await html2canvas($("brag").firstElementChild, { scale: 2, backgroundColor: null });
    const a = document.createElement("a");
    a.download = `오행종목_${$("name").value.trim() || "나"}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
    toast("그림을 저장했어요.");
  } catch (e) {
    toast(`그림을 만들지 못했어요. (${e.message})`);
  }
});

$("copy").addEventListener("click", async () => {
  const url = location.href;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    const ta = Object.assign(document.createElement("textarea"), { value: url });
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast("링크를 복사했어요. 단톡방에 붙여 넣어 보세요!");
});

// ---------- 디자인 고르기 ----------
// 겉모습만 바꾼다. 결과가 떠 있으면 그래프 색만 새 디자인에 맞게 다시 그린다(숫자는 그대로).

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
  if (lastForm) run(lastForm);
});

// 공유 링크로 들어오면 바로 결과를 보여 준다.
const shared = fromQuery();
if (shared) {
  writeForm(shared);
  run(shared);
}
