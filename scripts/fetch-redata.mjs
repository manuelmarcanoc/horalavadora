/**
 * fetch-redata.mjs
 * Obtiene el precio horario del mercado diario (OMIE) de España
 * usando la API pública de REData (Red Eléctrica) — SIN TOKEN, sin registro.
 *
 * Uso: node scripts/fetch-redata.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchPrices, madridDateStr } from "../lib/redata.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "public", "data.json");

async function main() {
  const today = madridDateStr();
  console.log(`📅 Fetching REData para ${today}…`);

  let out;
  try {
    out = await fetchPrices();
    console.log(`✅ ${out.days.length} día(s) · ${out.days.reduce((s, d) => s + d.hours.length, 0)} horas`);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`💾 Guardado en: ${OUT_PATH}`);

  try {
    const htmlPath = path.join(__dirname, "..", "public", "index.html");
    let html = await fs.readFile(htmlPath, "utf8");

    const [y, m, d] = today.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d, 12));
    const formattedDate = new Intl.DateTimeFormat("es-ES", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Europe/Madrid",
    }).format(dt);

    html = html.replace(/<title>.*?<\/title>/, `<title>HoraLavadora — Precio de la luz hoy, ${formattedDate}</title>`);
    html = html.replace(
      /<meta name="description" content=".*?" \/>/,
      `<meta name="description" content="Consulta la mejor hora para poner la lavadora hoy, ${formattedDate}. Precio de la luz en España hora a hora, actualizado cada hora." />`
    );
    html = html.replace(
      /<meta property="og:title"\s+content=".*?" \/>/,
      `<meta property="og:title"       content="Precio de la luz hoy, ${formattedDate} · €/kWh" />`
    );
    html = html.replace(
      /<meta name="twitter:title"\s+content=".*?" \/>/,
      `<meta name="twitter:title"       content="Precio de la luz hoy, ${formattedDate} · HoraLavadora" />`
    );

    await fs.writeFile(htmlPath, html, "utf8");
    console.log(`📝 SEO actualizado para: ${formattedDate}`);

    const sitemapPath = path.join(__dirname, "..", "public", "sitemap.xml");
    let sitemap = await fs.readFile(sitemapPath, "utf8");
    sitemap = sitemap.replace(/<lastmod>.*?<\/lastmod>/, `<lastmod>${today}</lastmod>`);
    await fs.writeFile(sitemapPath, sitemap, "utf8");
    console.log(`🗺️ Sitemap actualizado: ${today}`);
  } catch (err) {
    console.error(`⚠️ SEO: ${err.message}`);
  }
}

main().catch((err) => {
  console.error("\n💥 Error fatal:", err.message);
  process.exit(1);
});
