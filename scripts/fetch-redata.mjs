/**
 * fetch-redata.mjs
 * Obtiene el precio horario del mercado diario (OMIE) de España
 * usando la API pública de REData (Red Eléctrica) — SIN TOKEN, sin registro.
 *
 * API: https://apidatos.ree.es
 * Indicador: "Precio mercado spot diario" (OMIE) — incluido en "mercados"
 *
 * Uso:
 *   node scripts/fetch-redata.mjs
 *
 * Opciones de entorno:
 *   REDATA_DAYS_BACK=0   → cuántos días atrás incluir además de hoy (0 = solo hoy)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH   = path.join(__dirname, "..", "public", "data.json");
const TZ         = "Europe/Madrid";

// ─── helpers de fecha ────────────────────────────────────────────────────────

function madridDateStr(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date); // → "YYYY-MM-DD"
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  dt.setUTCDate(dt.getUTCDate() + n);
  return madridDateStr(dt);
}

// ─── fetch REData ─────────────────────────────────────────────────────────────

/**
 * Llama a la API pública REData y devuelve los valores horarios del SPOT/OMIE
 * para el rango pedido.
 *
 * La API devuelve €/MWh → convertimos a €/kWh dividiendo entre 1000.
 *
 * Endpoint documentado:
 *   GET /es/datos/mercados/precios-mercados-tiempo-real
 *   ?time_trunc=hour
 *   &start_date=YYYY-MM-DDTHH:MM
 *   &end_date=YYYY-MM-DDTHH:MM
 *   &geo_trunc=electric_system
 *   &geo_limit=peninsular
 *   &geo_ids=8741
 */
async function fetchRedata(dateStr) {
  const start = `${dateStr}T00:00`;
  const end   = `${dateStr}T23:59`;

  const url = new URL(
    "https://apidatos.ree.es/es/datos/mercados/precios-mercados-tiempo-real"
  );
  url.searchParams.set("time_trunc",  "hour");
  url.searchParams.set("start_date",  start);
  url.searchParams.set("end_date",    end);
  url.searchParams.set("geo_trunc",   "electric_system");
  url.searchParams.set("geo_limit",   "peninsular");
  url.searchParams.set("geo_ids",     "8741");

  const res = await fetch(url.toString(), {
    headers: {
      Accept:          "application/json",
      "Content-Type":  "application/json",
      // REData no requiere auth, pero sí un User-Agent razonable
      "User-Agent": "horalavadora.es/1.0 (proyecto educativo; contacto: horalavadora.es)",
    },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`REData HTTP ${res.status} para ${dateStr}: ${txt.slice(0, 300)}`);
  }

  const json = await res.json();

  // La respuesta tiene: data.included[] con type "Mercados"
  // Dentro, attributes.values[] → { value (€/MWh), datetime, percentage }
  const included = json?.included ?? [];

  // Buscamos el bloque de "Precio mercado spot diario" o similar
  // REData devuelve varios mercados; nos quedamos con el que tiene más registros
  // o con el que se llama "Precio mercado spot diario"
  let targetValues = null;

  for (const item of included) {
    const type  = item?.type ?? "";
    const title = (item?.attributes?.title ?? "").toLowerCase();
    const vals  = item?.attributes?.values;

    if (!Array.isArray(vals) || vals.length === 0) continue;

    // "Precio mercado spot diario" o cualquier bloque de tipo Mercados con valores
    if (
      type === "Mercados" ||
      title.includes("spot") ||
      title.includes("omie") ||
      title.includes("diario")
    ) {
      // Preferimos el que tiene exactamente 24 registros (un día completo)
      if (!targetValues || vals.length > targetValues.length) {
        targetValues = vals;
      }
    }
  }

  // Fallback: primer bloque con datos
  if (!targetValues) {
    for (const item of included) {
      const vals = item?.attributes?.values;
      if (Array.isArray(vals) && vals.length > 0) {
        targetValues = vals;
        break;
      }
    }
  }

  if (!targetValues || targetValues.length === 0) {
    throw new Error(`REData no devolvió valores para ${dateStr}. Respuesta: ${JSON.stringify(json).slice(0, 400)}`);
  }

  // Construimos el array de horas en el formato interno de la app
  const hours = targetValues
    .filter((v) => v && typeof v.datetime === "string" && Number.isFinite(Number(v.value)))
    .map((v) => {
      const priceEurMwh = Number(v.value);
      const priceEurKwh = Number((priceEurMwh / 1000).toFixed(6));
      const start       = v.datetime;                  // ISO string con offset
      const end         = v.datetime_end ?? null;      // puede no venir
      return { start, end, price: priceEurKwh };
    })
    .sort((a, b) => new Date(a.start) - new Date(b.start))
    .slice(0, 24); // máx 24 horas

  return { date: dateStr, hours };
}

// ─── datos de demo (sin red) ─────────────────────────────────────────────────

function demoDay(dateStr) {
  console.warn(`⚠  Usando datos DEMO para ${dateStr} (fallo de red o API no disponible)`);
  const hours = Array.from({ length: 24 }, (_, h) => {
    const base = 0.095;
    const wave = 0.055 * Math.sin(((h - 7) / 24) * Math.PI * 2);
    const peak = h >= 18 && h <= 22 ? 0.06 : 0;
    const price = Number(Math.max(0.045, base + wave + peak).toFixed(6));
    const hh    = String(h).padStart(2, "0");
    const hh2   = String((h + 1) % 24).padStart(2, "0");
    const nextD = h === 23 ? addDays(dateStr, 1) : dateStr;
    return {
      start: `${dateStr}T${hh}:00:00+02:00`,
      end:   `${nextD}T${hh2}:00:00+02:00`,
      price,
    };
  });
  return { date: dateStr, hours };
}

// ─── estadísticas ────────────────────────────────────────────────────────────

function summary(day) {
  const prices = day.hours.map((h) => h.price).filter(Number.isFinite);
  const sorted = [...prices].sort((a, b) => a - b);
  return {
    min:  sorted[0] ?? null,
    max:  sorted.at(-1) ?? null,
    mean: sorted.length
      ? Number((sorted.reduce((s, x) => s + x, 0) / sorted.length).toFixed(6))
      : null,
  };
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const today    = madridDateStr();
  const tomorrow = addDays(today, 1);

  console.log(`📅 Fetching REData para hoy: ${today} y mañana: ${tomorrow}`);

  const days = [];

  // ── Hoy ──────────────────────────────────────────────────────────────────
  let todayData;
  try {
    todayData = await fetchRedata(today);
    console.log(`✅ Hoy: ${todayData.hours.length} horas obtenidas`);
  } catch (err) {
    console.error(`❌ Error fetching hoy: ${err.message}`);
    todayData = demoDay(today);
  }
  days.push({ ...todayData, summary: summary(todayData) });

  // ── Mañana (opcional, disponible ~14:15h) ─────────────────────────────────
  try {
    const tomorrowData = await fetchRedata(tomorrow);
    if (tomorrowData.hours.length >= 12) {
      console.log(`✅ Mañana: ${tomorrowData.hours.length} horas obtenidas`);
      days.push({ ...tomorrowData, summary: summary(tomorrowData) });
    } else {
      console.log(`ℹ  Mañana: solo ${tomorrowData.hours.length} horas — aún no publicado, se omite`);
    }
  } catch {
    console.log(`ℹ  Mañana aún no disponible (normal antes de ~14:15h)`);
  }

  // ── Escribe el JSON ────────────────────────────────────────────────────────
  const out = {
    generatedAt: new Date().toISOString(),
    source: {
      provider:    "REData (Red Eléctrica de España)",
      endpoint:    "https://apidatos.ree.es/es/datos/mercados/precios-mercados-tiempo-real",
      description: "Precio mercado spot diario OMIE — €/kWh (convertido de €/MWh)",
    },
    timezone: TZ,
    currency: "EUR",
    unit:     "EUR_PER_KWH",
    days,
  };

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`\n💾 Guardado en: ${OUT_PATH}`);
  console.log(`   ${days.length} día(s) · ${days.reduce((s, d) => s + d.hours.length, 0)} horas totales`);
}

main().catch((err) => {
  console.error("\n💥 Error fatal:", err.message);
  process.exit(1);
});
