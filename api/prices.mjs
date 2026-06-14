import { fetchPrices } from "../lib/redata.mjs";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=3600");

  try {
    const data = await fetchPrices();
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
