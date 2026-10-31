// 신호 차트의 세 가지 신호 계산. 화면 코드와 떨어뜨려 두어 기준만 따로 고칠 수 있게 한다.
// rows: [{date:"YYYY-MM-DD", open, high, low, close, volume}, ...] (날짜 오름차순)

// 쌍바닥 기준 (사용자와 정한 값)
export const W_RULE = {
  maxGap: 0.03,    // 두 바닥 저가 차이: 첫 바닥의 3% 이내
  minDays: 10,     // 두 바닥 사이: 10거래일 이상
  maxDays: 60,     //               60거래일 이하
  minBounce: 0.10, // 가운데 봉우리(고가)가 첫 바닥보다 10% 이상
  pivot: 3,        // 앞뒤 3거래일 중 가장 낮은 저가를 '바닥'으로 본다
};

export function movingAverage(rows, n) {
  const out = new Array(rows.length).fill(null);
  let sum = 0;
  rows.forEach((r, i) => {
    sum += r.close;
    if (i >= n) sum -= rows[i - n].close;
    if (i >= n - 1) out[i] = sum / n;
  });
  return out;
}

// ▲ 5일선이 20일선을 아래에서 위로 뚫은 날
export function goldenCrosses(rows, ma5, ma20) {
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (ma20[i - 1] == null) continue;
    if (ma5[i - 1] <= ma20[i - 1] && ma5[i] > ma20[i]) {
      out.push({ i, ma5: ma5[i], ma20: ma20[i] });
    }
  }
  return out;
}

// ★ 오늘 고가가 직전 1년(365일) 최고가를 넘긴 날 중, 전날은 넘기지 못했던 날(처음 다시 넘긴 날)만.
// 1년치 앞 기록이 다 있는 날부터 본다.
export function yearHighBreaks(rows) {
  const out = [];
  const hitDays = [];
  let prevHit = false;
  let from = 0;
  const first = new Date(rows[0].date);
  for (let i = 0; i < rows.length; i++) {
    const yearAgo = new Date(rows[i].date);
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    if (yearAgo < first) continue;
    while (new Date(rows[from].date) < yearAgo) from++;
    let prevHigh = 0;
    for (let k = from; k < i; k++) prevHigh = Math.max(prevHigh, rows[k].high);
    const hit = rows[i].high > prevHigh;
    if (hit) hitDays.push(i);
    if (hit && !prevHit) out.push({ i, prevHigh });
    prevHit = hit;
  }
  return { marks: out, hitDays };
}

function isBottom(rows, j, k) {
  if (j < k || j + k >= rows.length) return false;
  for (let t = j - k; t <= j + k; t++) {
    if (t === j) continue;
    // 같은 저가가 이어지면 맨 앞날 하나만 바닥으로 센다.
    if (rows[t].low < rows[j].low || (t < j && rows[t].low === rows[j].low)) return false;
  }
  return true;
}

// W 두 번째 바닥 뒤에 종가가 가운데 봉우리(목선)를 넘긴 날 = 쌍바닥 완성.
// 그 전에 두 바닥보다 더 내려가면 깨진 것으로 보고, 두 번째 바닥에서 maxDays 안에 넘겨야 한다.
export function doubleBottoms(rows, rule = W_RULE) {
  const bottoms = [];
  for (let j = 0; j < rows.length; j++) if (isBottom(rows, j, rule.pivot)) bottoms.push(j);

  const done = new Map(); // 완성일 → 신호 (같은 날 겹치면 하나만)
  for (let b = 0; b < bottoms.length; b++) {
    const j = bottoms[b];
    for (let a = b - 1; a >= 0; a--) {
      const i = bottoms[a];
      const days = j - i;
      if (days < rule.minDays) continue;
      if (days > rule.maxDays) break;

      const l1 = rows[i].low, l2 = rows[j].low;
      if (Math.abs(l2 - l1) / l1 > rule.maxGap) continue;
      const floor = Math.min(l1, l2);

      let peak = 0, peakAt = i, broken = false;
      for (let t = i + 1; t < j; t++) {
        if (rows[t].low < floor) { broken = true; break; }
        if (rows[t].high > peak) { peak = rows[t].high; peakAt = t; }
      }
      if (broken || (peak - l1) / l1 < rule.minBounce) continue;

      // 두 번째 바닥은 앞뒤 pivot일을 봐야 확인되므로 그 뒤부터 완성일을 찾는다.
      let k = -1;
      for (let t = j + rule.pivot; t < rows.length && t - j <= rule.maxDays; t++) {
        if (rows[t].low < floor) break;
        if (rows[t].close > peak) { k = t; break; }
      }
      if (k < 0) continue;
      if (!done.has(k)) done.set(k, { i: k, first: i, second: j, peakAt, neck: peak });
      break; // 이 두 번째 바닥은 가장 가까운 첫 바닥 하나와만 짝짓는다.
    }
  }
  return [...done.values()].sort((x, y) => x.i - y.i);
}
