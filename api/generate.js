// api/generate.js — Vercel Serverless Function
// Your API key stays safe here, users never see it.

const RATE_LIMIT = 3; // free generations per day per user
const store = new Map(); // in-memory (resets on redeploy; upgrade to Vercel KV later)

function getRateKey(req) {
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers["x-real-ip"] ||
    "unknown";
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `${ip}::${today}`;
}

export default async function handler(req, res) {
  // CORS — allow your frontend domain
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  // ── Rate limiting ──
  const rateKey = getRateKey(req);
  const used = store.get(rateKey) || 0;
  if (used >= RATE_LIMIT) {
    return res.status(429).json({
      error: `Daily limit reached. You get ${RATE_LIMIT} free generations per day. Come back tomorrow! 😊`,
      limitReached: true,
    });
  }

  // ── Validate request body ──
  const { prompt, type } = req.body || {};
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Invalid request." });
  }
  if (prompt.length > 2000) {
    return res.status(400).json({ error: "Prompt too long." });
  }

  // ── Call Claude API ──
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server not configured. Contact admin." });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001", // cheapest model — saves your budget!
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(502).json({
        error: err?.error?.message || "AI service error. Try again.",
      });
    }

    const data = await response.json();
    const text = data?.content?.[0]?.text || "";

    // Increment rate limit counter only on success
    store.set(rateKey, used + 1);

    return res.status(200).json({
      result: text,
      usedToday: used + 1,
      limitPerDay: RATE_LIMIT,
    });
  } catch (err) {
    console.error("Claude API error:", err);
    return res.status(502).json({ error: "Network error. Please try again." });
  }
}
