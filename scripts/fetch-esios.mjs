import fs from "node:fs/promises";
import path from "node:path";

const ESIOS_TOKEN = process.env.ESIOS_TOKEN || "YOUR_ESIOS_TOKEN";

// ESIOS: Mercado diario (OMIE) precio horario. Es el más común para "precio por horas".
// Endpoint: https://api.esios.ree.es/indicators/1001
// Nota: si en tu caso quieres PVPC u otro indicador, cambia INDICATOR_ID.
const INDICATOR_ID = process.env.ESIOS_INDICATOR_ID || "1001";
const GEO_ID = Number(process.env.ESIOS_GEO_ID || 3); // 3 = España (habitual)

const TZ = "Europe/Madrid";

function isPlaceholderToken(t) {
  return !t || t === "YOUR_ESIOS_TOKEN" || t.toLowerCase().includes("your_esios_token");
}

function yyyyMmDdInMadrid(date) {
  // Devuelve YYYY-MM-DD en la zona Europe/Madrid, sin depender del TZ de la máquina.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function demoDay(yyyyMmDd) {
  // Dataset sintético (para probar sin token): 24 horas suaves con pico tarde.
  // Generamos ISO strings “Z” para que el frontend funcione igual.
  const hours = Array.from({ length: 24 }, (_, h) => {
    const base = 0.095; // €/kWh
    const wave = 0.055 * Math.sin(((h - 7) / 24) * Math.PI * 2);
    const peak = h >= 18 && h <= 22 ? 0.06 : 0;
    const price = Number(Math.max(0.045, base + wave + peak).toFixed(6));
    const hh = String(h).padStart(2, "0");
    const isLast = h === 23;
    const endDate = isLast ? nextDateStr(yyyyMmDd) : yyyyMmDd;
    const hh2 = String((h + 1) % 24).padStart(2, "0");
    return {
      start: `${yyyyMmDd}T${hh}:00:00Z`,
      end: `${endDate}T${hh2}:00:00Z`,
      price,
    };
  });
  return { date: yyyyMmDd, hours };
}

function nextDateStr(yyyyMmDd) {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function isoRangeForMadridDay(yyyyMmDd) {
  // ESIOS suele aceptar fechas sin offset; usamos Z explícito para evitar ambigüedades.
  // Pedimos el día completo 00:00 a 23:59.
  return {
    start_date: `${yyyyMmDd}T00:00:00Z`,
    end_date: `${yyyyMmDd}T23:59:59Z`,
  };
}

async function fetchIndicatorDay({ yyyyMmDd }) {
  const { start_date, end_date } = isoRangeForMadridDay(yyyyMmDd);
  const url = new URL(`https://api.esios.ree.es/indicators/${INDICATOR_ID}`);
  url.searchParams.set("start_date", start_date);
  url.searchParams.set("end_date", end_date);

  const res = await fetch(url, {
    headers: {
      Accept: "application/json; application/vnd.esios-api-v2+json",
      "Content-Type": "application/json",
      Host: "api.esios.ree.es",
      Authorization: `Token token="${ESIOS_TOKEN}"`,
      "x-api-key": ESIOS_TOKEN
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ESIOS ${res.status} ${res.statusText} - ${text.slice(0, 400)}`);
  }

  const json = await res.json();
  const values = json?.indicator?.values;
  if (!Array.isArray(values)) {
    throw new Error("Respuesta ESIOS inesperada: indicator.values no es un array");
  }

  const filtered = values
    .filter((v) => v && (v.geo_id == null || Number(v.geo_id) === GEO_ID))
    .map((v) => ({
      start: v.datetime, // ISO string
      end: v.datetime_to, // ISO string
      value: Number(v.value),
    }))
    .filter((v) => Number.isFinite(v.value) && typeof v.start === "string");

  // ESIOS normalmente devuelve €/MWh para este indicador. Convertimos a €/kWh.
  // Si ya viniera en €/kWh, este factor sería incorrecto; por eso dejamos el factor configurable.
  const factorToEurPerKwh = Number(process.env.ESIOS_TO_EUR_PER_KWH_FACTOR || 1 / 1000);

  const hours = filtered
    .map((v) => ({
      start: v.start,
      end: v.end,
      price: Number((v.value * factorToEurPerKwh).toFixed(6)),
    }))
    .sort((a, b) => new Date(a.start) - new Date(b.start));

  // Nos quedamos con 24 valores si hay más.
  return {
    date: yyyyMmDd,
    hours: hours.slice(0, 24),
  };
}

function computeSummary(day) {
  const prices = day.hours.map((h) => h.price).filter(Number.isFinite);
  const sorted = [...prices].sort((a, b) => a - b);
  const min = sorted[0] ?? null;
  const max = sorted.at(-1) ?? null;
  const mean =
    sorted.length > 0
      ? Number((sorted.reduce((s, x) => s + x, 0) / sorted.length).toFixed(6))
      : null;
  return { min, max, mean };
}

async function main() {
  const now = new Date();
  const today = yyyyMmDdInMadrid(now);

  // Intentamos traer hoy y mañana. Si mañana no está publicado, se omite.
  const tomorrowDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrow = yyyyMmDdInMadrid(tomorrowDate);

  const days = [];
  const todayData = isPlaceholderToken(ESIOS_TOKEN)
    ? demoDay(today)
    : await fetchIndicatorDay({ yyyyMmDd: today });
  days.push({ ...todayData, summary: computeSummary(todayData) });

  if (isPlaceholderToken(ESIOS_TOKEN)) {
    const tomorrowData = demoDay(tomorrow);
    days.push({ ...tomorrowData, summary: computeSummary(tomorrowData) });
  } else {
    try {
      const tomorrowData = await fetchIndicatorDay({ yyyyMmDd: tomorrow });
      // Si la API devuelve algo vacío/no útil, lo ignoramos.
      if (tomorrowData.hours?.length >= 12) {
        days.push({ ...tomorrowData, summary: computeSummary(tomorrowData) });
      }
    } catch {
      // Mañana aún no disponible o token/permiso: no es fatal.
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: {
      provider: "ESIOS (REE)",
      indicatorId: String(INDICATOR_ID),
      geoId: GEO_ID,
    },
    timezone: TZ,
    currency: "EUR",
    unit: "EUR_PER_KWH",
    days,
  };

  const outPath = path.join(process.cwd(), "public", "data.json");
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`OK: escrito ${outPath} (${days.length} día(s))`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

