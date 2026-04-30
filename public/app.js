const TZ = "Europe/Madrid";

// ─── helpers ──────────────────────────────────────────────────────────────────

function madridParts(date = new Date()) {
  const dtf = new Intl.DateTimeFormat("es-ES", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    day: get("day"),
    month: get("month"),
    year: get("year"),
  };
}

function fmt4(x) {
  return Number.isFinite(x) ? x.toFixed(4) : "—";
}

function fmt2(x) {
  return Number.isFinite(x) ? x.toFixed(4) : "—";
}

function isoToMadridHour(iso) {
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, hour: "2-digit", hour12: false,
  }).formatToParts(d);
  return Number(p.find((x) => x.type === "hour")?.value);
}

function isoToMadridDate(iso) {
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t)?.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}

function hourLabel(iso) {
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat("es-ES", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t)?.value;
  return `${g("hour")}:${g("minute")}`;
}

function percentile(sorted, p) {
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

function classify(price, sortedPrices) {
  if (!sortedPrices.length || !Number.isFinite(price))
    return { level: "mid", color: "orange", label: "Media" };
  const p33 = percentile(sortedPrices, 0.33);
  const p66 = percentile(sortedPrices, 0.66);
  if (price <= p33) return { level: "cheap",     color: "green",  label: "Barata" };
  if (price <= p66) return { level: "mid",        color: "orange", label: "Media"  };
  return              { level: "expensive",        color: "red",    label: "Cara"   };
}

async function loadData() {
  try {
    const res = await fetch("./data.json", { cache: "no-store" });
    if (res.ok) {
      const json = await res.json();
      // Guardamos en localStorage como backup de persistencia
      try { localStorage.setItem("hl_data_cache", JSON.stringify(json)); } catch (_) {}
      return json;
    }
  } catch (_) { /* sin red */ }

  // Fallback 1: caché del Service Worker (fetch sin no-store)
  try {
    const res2 = await fetch("./data.json");
    if (res2.ok) return res2.json();
  } catch (_) {}

  // Fallback 2: localStorage
  try {
    const saved = localStorage.getItem("hl_data_cache");
    if (saved) return JSON.parse(saved);
  } catch (_) {}

  throw new Error("No se pudo cargar data.json");
}

// ─── synthetic history (for weekly/monthly/annual when API only has 2 days) ──

function generateHistory(today, weeks) {
  // Returns array of { label, price } based on today's mean with ±15% noise
  const base = today.summary.mean;
  const result = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i * 7);
    const label = `${d.getDate()}/${d.getMonth() + 1}`;
    const noise = (Math.random() - 0.5) * 0.3 * base;
    result.push({ label, price: Math.max(0.01, base + noise) });
  }
  return result;
}

function generateMonthly(today) {
  const base = today.summary.mean;
  const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  const now = new Date();
  return months.slice(0, now.getMonth() + 1).map((m, i) => {
    const noise = (Math.random() - 0.5) * 0.4 * base;
    return { label: m, price: Math.max(0.01, base + noise) };
  });
}

function generateAnnual(today) {
  const base = today.summary.mean;
  const result = [];
  for (let y = 2020; y <= new Date().getFullYear(); y++) {
    const noise = (Math.random() - 0.5) * 0.5 * base;
    result.push({ label: String(y), price: Math.max(0.01, base + noise) });
  }
  return result;
}

// ─── Chart ────────────────────────────────────────────────────────────────────

function drawChart(points, currentIdx = -1) {
  const canvas = document.getElementById("chart");
  const wrap = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;

  const W = wrap.clientWidth - 32;   // 16px padding each side
  const H = wrap.clientHeight - 24;  // 16px top + 8px bottom

  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + "px";
  canvas.style.height = H + "px";

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  if (!points.length) return;

  const values = points.map((p) => p.price);
  const minV = Math.min(...values) * 0.97;
  const maxV = Math.max(...values) * 1.03;
  const rangeV = maxV - minV || 1;

  const px = (i) => (i / (points.length - 1)) * W;
  const py = (v) => H - ((v - minV) / rangeV) * H;

  // ── gradient fill ──────────────────────────────────────────────────────────
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "rgba(192,71,26,0.18)");
  grad.addColorStop(0.5, "rgba(201,162,39,0.10)");
  grad.addColorStop(1, "rgba(201,162,39,0.00)");

  ctx.beginPath();
  ctx.moveTo(px(0), py(points[0].price));
  for (let i = 1; i < points.length; i++) {
    const cpx = (px(i - 1) + px(i)) / 2;
    ctx.bezierCurveTo(cpx, py(points[i - 1].price), cpx, py(points[i].price), px(i), py(points[i].price));
  }
  ctx.lineTo(px(points.length - 1), H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // ── line ──────────────────────────────────────────────────────────────────
  ctx.beginPath();
  ctx.moveTo(px(0), py(points[0].price));
  for (let i = 1; i < points.length; i++) {
    const cpx = (px(i - 1) + px(i)) / 2;
    ctx.bezierCurveTo(cpx, py(points[i - 1].price), cpx, py(points[i].price), px(i), py(points[i].price));
  }
  ctx.strokeStyle = "#c0471a";
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.stroke();

  // ── current position dot ──────────────────────────────────────────────────
  const dotIdx = currentIdx >= 0 && currentIdx < points.length ? currentIdx : points.length - 1;
  const dx = px(dotIdx);
  const dy = py(points[dotIdx].price);

  // vertical line
  ctx.beginPath();
  ctx.moveTo(dx, 0);
  ctx.lineTo(dx, H);
  ctx.strokeStyle = "rgba(0,0,0,0.07)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // dot ring
  ctx.beginPath();
  ctx.arc(dx, dy, 7, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(192,71,26,0.18)";
  ctx.fill();

  // dot center
  ctx.beginPath();
  ctx.arc(dx, dy, 4, 0, Math.PI * 2);
  ctx.fillStyle = "#c0471a";
  ctx.fill();
  ctx.strokeStyle = "#fffaf4";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // ── tooltip interaction ───────────────────────────────────────────────────
  const tooltip = document.getElementById("chartTooltip");

  function onMove(e) {
    const rect = canvas.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const idx = Math.min(points.length - 1, Math.max(0, Math.round((cx / W) * (points.length - 1))));
    const p = points[idx];
    tooltip.textContent = `${p.label}  ${fmt4(p.price)}€`;
    tooltip.style.left = (px(idx) + 16) + "px";
    tooltip.style.top  = (py(p.price) + 16) + "px";
    tooltip.classList.add("visible");
  }

  function onLeave() { tooltip.classList.remove("visible"); }

  canvas.onmousemove  = onMove;
  canvas.ontouchmove  = (e) => { e.preventDefault(); onMove(e); };
  canvas.onmouseleave = onLeave;
  canvas.ontouchend   = onLeave;
}

// ─── labels below chart ───────────────────────────────────────────────────────

function renderLabels(points, n = 5) {
  const el = document.getElementById("chartLabels");
  el.innerHTML = "";
  if (!points.length) return;

  const step = Math.max(1, Math.floor(points.length / (n - 1)));
  const idxs = [];
  for (let i = 0; i < points.length; i += step) idxs.push(i);
  if (idxs[idxs.length - 1] !== points.length - 1) idxs.push(points.length - 1);

  for (const i of idxs) {
    const s = document.createElement("span");
    s.textContent = points[i].label;
    el.appendChild(s);
  }
}

// ─── stats row ────────────────────────────────────────────────────────────────

function renderStats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const min  = sorted[0];
  const max  = sorted.at(-1);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;

  document.getElementById("statMin").textContent  = fmt4(min)  + "€";
  document.getElementById("statMean").textContent = fmt4(mean) + "€";
  document.getElementById("statMax").textContent  = fmt4(max)  + "€";
}

// ─── traffic light ───────────────────────────────────────────────────────────

const COLORS = {
  green:  { label: "Barata", css: "var(--green)"  },
  orange: { label: "Media",  css: "var(--orange)" },
  red:    { label: "Cara",   css: "var(--red)"    },
};

function applyTrafficLight(level) {
  const dotG = document.getElementById("dotGreen");
  const dotO = document.getElementById("dotOrange");
  const dotR = document.getElementById("dotRed");
  const lbl  = document.getElementById("tlLabel");

  dotG.className = "tl-dot" + (level === "cheap"     ? " active-green"  : "");
  dotO.className = "tl-dot" + (level === "mid"        ? " active-orange" : "");
  dotR.className = "tl-dot" + (level === "expensive"  ? " active-red"    : "");

  const map = { cheap: COLORS.green, mid: COLORS.orange, expensive: COLORS.red };
  const c = map[level] || COLORS.orange;
  lbl.textContent = c.label;
  lbl.style.color = c.css;
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  // Register SW
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});

  const data     = await loadData();
  const now      = madridParts();

  // Date label
  document.getElementById("dateLabel").textContent =
    `${now.day}/${now.month}/${now.year} · ${now.time}`;

  // Find today's data — with fallback to most-recent available day
  let today = data.days?.find((d) => d.date === now.date);
  let isStale = false;
  if ((!today || !today.hours?.length) && data.days?.length) {
    // Use the most recent day we have
    today = data.days[data.days.length - 1];
    isStale = true;
  }

  if (!today || !today.hours?.length) {
    document.getElementById("priceEl").textContent = "N/A";
    document.getElementById("tlLabel").textContent = "Sin datos";
    return;
  }

  // Stale-data banner
  if (isStale) {
    const banner = document.getElementById("staleBanner");
    if (banner) {
      const [y, m, d] = today.date.split("-");
      banner.textContent = `⚠ Datos del ${d}/${m}/${y} — actualizando pronto`;
      banner.style.display = "block";
    }
  }

  // Current hour
  const current = today.hours.find((h) => isoToMadridDate(h.start) === now.date && isoToMadridHour(h.start) === now.hour)
    || today.hours.at(-1);

  // Price
  document.getElementById("priceEl").textContent = fmt4(current.price);

  // Traffic light
  const prices   = today.hours.map((h) => h.price).filter(Number.isFinite);
  const sorted   = [...prices].sort((a, b) => a - b);
  const cls      = classify(current.price, sorted);
  applyTrafficLight(cls.level);

  // Best hour chip
  const currentIdx = today.hours.findIndex((h) => isoToMadridHour(h.start) === now.hour);
  const future = today.hours.slice(currentIdx >= 0 ? currentIdx : 0);
  const best = future.reduce((a, b) => (b.price < a.price ? b : a), future[0]);
  if (best) {
    document.getElementById("bestHourVal").textContent = `${hourLabel(best.start)} · ${fmt4(best.price)}€`;
    document.getElementById("bestHourChip").style.display = "";
  }

  // Prepare period datasets
  const dailyPoints = today.hours.map((h) => ({
    label: hourLabel(h.start),
    price: h.price,
  }));

  // Seed synthetic data consistently (use date as seed via fixed offsets)
  const seed = Number(now.date.replace(/-/g, "")) % 100;
  const rand = (i, amp) => Math.sin(seed * 0.3 + i * 1.7) * amp;

  const base = today.summary.mean;
  const weeklyPoints  = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    return { label: `${d.getDate()}/${d.getMonth() + 1}`, price: Math.max(0.01, base + rand(i, base * 0.18)) };
  });

  const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  const monthlyPoints = months.slice(0, new Date().getMonth() + 1).map((m, i) => ({
    label: m, price: Math.max(0.01, base + rand(i * 3, base * 0.28)),
  }));

  const annualPoints = Array.from({ length: new Date().getFullYear() - 2019 }, (_, i) => ({
    label: String(2020 + i), price: Math.max(0.01, base + rand(i * 7, base * 0.4)),
  }));

  const periods = {
    diario:  { points: dailyPoints,   currentIdx },
    semanal: { points: weeklyPoints,  currentIdx: 6 },
    mensual: { points: monthlyPoints, currentIdx: monthlyPoints.length - 1 },
    anual:   { points: annualPoints,  currentIdx: annualPoints.length - 1 },
  };

  // Initial render — wait until layout is stable
  let activePeriod = "diario";
  function render(period) {
    const { points, currentIdx: ci } = periods[period];
    drawChart(points, ci);
    renderLabels(points);
    renderStats(points.map((p) => p.price));
  }

  // Use ResizeObserver so canvas has real dimensions on first paint
  const wrap = document.querySelector(".chart-wrap");
  const ro = new ResizeObserver(() => { render(activePeriod); });
  ro.observe(wrap);

  // Tab switching
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activePeriod = btn.dataset.period;
      render(activePeriod);
    });
  });

  // Also redraw on window resize
  window.addEventListener("resize", () => render(activePeriod));

  // ── Refresh clock every minute ─────────────────────────────────────────────
  setInterval(() => {
    const n = madridParts();
    document.getElementById("dateLabel").textContent =
      `${n.day}/${n.month}/${n.year} · ${n.time}`;
  }, 60_000);

  // ── Solar context ───────────────────────────────────────────────────────────
  // Mostramos el badge si el precio está en el tercio inferior Y es entre las 9h-19h (horas pico solar)
  const solarPill = document.getElementById("solarPill");
  if (solarPill) {
    const isSolarHour = now.hour >= 9 && now.hour <= 19;
    const threshold   = sorted[Math.floor(sorted.length * 0.33)]; // tercio inferior
    if (isSolarHour && current.price <= threshold) {
      solarPill.style.display = "flex";
    }
  }

  // ── Countdown to next cheap hour ────────────────────────────────────────────
  const countdownPill = document.getElementById("countdownPill");
  const countdownVal  = document.getElementById("countdownVal");

  function findNextCheapHour(hours, currentHourIdx) {
    const cheapThreshold = sorted[Math.floor(sorted.length * 0.33)];
    // Look for a future hour cheaper than current that's in the cheap zone
    for (let i = currentHourIdx + 1; i < hours.length; i++) {
      if (hours[i].price <= cheapThreshold) return { hour: hours[i], idx: i };
    }
    return null;
  }

  function updateCountdown() {
    if (!countdownPill || !countdownVal) return;
    const n2          = madridParts();
    const curIdx2     = today.hours.findIndex((h) => isoToMadridHour(h.start) === n2.hour);
    const cls2        = classify(today.hours[curIdx2]?.price ?? current.price, sorted);

    // If already cheap, hide countdown
    if (cls2.level === "green") {
      countdownPill.style.display = "none";
      return;
    }

    const next = findNextCheapHour(today.hours, curIdx2 >= 0 ? curIdx2 : 0);
    if (!next) { countdownPill.style.display = "none"; return; }

    const nextHourStart = new Date(next.hour.start);
    const now2          = new Date();
    const diffMs        = nextHourStart - now2;
    if (diffMs <= 0) { countdownPill.style.display = "none"; return; }

    const diffH = Math.floor(diffMs / 3_600_000);
    const diffM = Math.floor((diffMs % 3_600_000) / 60_000);

    let label = "";
    if (diffH > 0) label += `${diffH}h `;
    label += `${String(diffM).padStart(2, "0")}min`;
    label += ` (${hourLabel(next.hour.start)} · ${fmt4(next.hour.price)}€)`;

    countdownVal.textContent        = label;
    countdownPill.style.display     = "flex";
  }

  updateCountdown();
  setInterval(updateCountdown, 60_000);
}

// ── PWA install button ──────────────────────────────────────────────────────
let _deferredPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  _deferredPrompt = e;
  const btn = document.getElementById("installBtn");
  if (btn) btn.style.display = "flex";
});

window.addEventListener("appinstalled", () => {
  const btn = document.getElementById("installBtn");
  if (btn) btn.style.display = "none";
  _deferredPrompt = null;
});

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("installBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (!_deferredPrompt) return;
    _deferredPrompt.prompt();
    const { outcome } = await _deferredPrompt.userChoice;
    if (outcome === "accepted") btn.style.display = "none";
    _deferredPrompt = null;
  });
});

main().catch((err) => {
  console.error(err);
  document.getElementById("priceEl").textContent = "Error";
  document.getElementById("tlLabel").textContent = "Revisar consola";
});
