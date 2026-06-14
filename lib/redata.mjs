/**
 * Lógica compartida para obtener precios horarios desde REData (REE).
 * Usado por: scripts/fetch-redata.mjs, api/prices.mjs
 */

export const TZ = "Europe/Madrid";
export const REDATA_URL =
  "https://apidatos.ree.es/es/datos/mercados/precios-mercados-tiempo-real";

export function madridDateStr(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  dt.setUTCDate(dt.getUTCDate() + n);
  return madridDateStr(dt);
}

export function parseRedataJson(json, dateStr) {
  const included = json?.included ?? [];
  let targetValues = null;

  for (const item of included) {
    const type = item?.type ?? "";
    const title = (item?.attributes?.title ?? "").toLowerCase();
    const vals = item?.attributes?.values;
    if (!Array.isArray(vals) || vals.length === 0) continue;

    if (
      type === "Mercados" ||
      title.includes("spot") ||
      title.includes("omie") ||
      title.includes("diario")
    ) {
      if (!targetValues || vals.length > targetValues.length) {
        targetValues = vals;
      }
    }
  }

  if (!targetValues) {
    for (const item of included) {
      const vals = item?.attributes?.values;
      if (Array.isArray(vals) && vals.length > 0) {
        targetValues = vals;
        break;
      }
    }
  }

  if (!targetValues?.length) {
    throw new Error(`REData sin valores para ${dateStr}`);
  }

  const hours = targetValues
    .filter((v) => v && typeof v.datetime === "string" && Number.isFinite(Number(v.value)))
    .map((v) => ({
      start: v.datetime,
      end: v.datetime_end ?? null,
      price: Number((Number(v.value) / 1000).toFixed(6)),
    }))
    .sort((a, b) => new Date(a.start) - new Date(b.start))
    .slice(0, 24);

  return { date: dateStr, hours };
}

export async function fetchRedataDay(dateStr, fetchFn = fetch) {
  const url = new URL(REDATA_URL);
  url.searchParams.set("time_trunc", "hour");
  url.searchParams.set("start_date", `${dateStr}T00:00`);
  url.searchParams.set("end_date", `${dateStr}T23:59`);
  url.searchParams.set("geo_trunc", "electric_system");
  url.searchParams.set("geo_limit", "peninsular");
  url.searchParams.set("geo_ids", "8741");

  const res = await fetchFn(url.toString(), {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "horalavadora.es/1.0 (proyecto educativo; contacto: horalavadora.es)",
    },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`REData HTTP ${res.status} para ${dateStr}: ${txt.slice(0, 200)}`);
  }

  return parseRedataJson(await res.json(), dateStr);
}

export function summary(day) {
  const prices = day.hours.map((h) => h.price).filter(Number.isFinite);
  const sorted = [...prices].sort((a, b) => a - b);
  return {
    min: sorted[0] ?? null,
    max: sorted.at(-1) ?? null,
    mean: sorted.length
      ? Number((sorted.reduce((s, x) => s + x, 0) / sorted.length).toFixed(6))
      : null,
  };
}

export async function fetchPrices(fetchFn = fetch) {
  const today = madridDateStr();
  const tomorrow = addDays(today, 1);
  const days = [];

  let todayData;
  try {
    todayData = await fetchRedataDay(today, fetchFn);
  } catch (err) {
    throw new Error(`No se pudo obtener precios de hoy: ${err.message}`);
  }
  days.push({ ...todayData, summary: summary(todayData) });

  try {
    const tomorrowData = await fetchRedataDay(tomorrow, fetchFn);
    if (tomorrowData.hours.length >= 12) {
      days.push({ ...tomorrowData, summary: summary(tomorrowData) });
    }
  } catch {
    // Mañana aún no publicado — normal antes de ~14:15h
  }

  return {
    generatedAt: new Date().toISOString(),
    source: {
      provider: "REData (Red Eléctrica de España)",
      endpoint: REDATA_URL,
      description: "Precio mercado spot diario OMIE — €/kWh (convertido de €/MWh)",
    },
    timezone: TZ,
    currency: "EUR",
    unit: "EUR_PER_KWH",
    days,
  };
}
