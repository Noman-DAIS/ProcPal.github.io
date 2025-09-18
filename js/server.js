//js/server.js

// Node 18+ (built-in fetch). Install deps: express, cors, dotenv
import express from "express";
import cors from "cors";
import "dotenv/config";
import { pipeline } from "node:stream";
import { promisify } from "node:util";

const app = express();
const PORT = process.env.PORT || 8787;
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "http://localhost:8080";
const OPENAI_BASE = process.env.OPENAI_BASE || "https://api.openai.com";
const pipe = promisify(pipeline);

// CORS (lock to your site/domain)
app.use(cors({
  origin: ALLOW_ORIGIN,
  methods: ["POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  credentials: false
}));

app.use(express.json({ limit: "1mb" }));
app.options("*", (_, res) => res.sendStatus(204));

// Helper to proxy POST to an OpenAI path (streams supported)
async function proxyOpenAI(path, req, res) {
  try {
    const upstream = await fetch(`${OPENAI_BASE}${path}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(req.body)
    });

    // Mirror status & critical headers; keep CORS header
    res.status(upstream.status);
    res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
    const ct = upstream.headers.get("content-type") || "application/json";
    res.setHeader("Content-Type", ct);
    if (ct.includes("text/event-stream")) {
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
    }

    // Stream body through
    if (upstream.body) await pipe(upstream.body, res);
    else res.end();
  } catch (err) {
    console.error("[proxy error]", err);
    res.status(500).json({ error: { message: "Proxy error", detail: String(err) } });
  }
}

// Drop-in routes (add more if you use other endpoints)
app.post("/v1/chat/completions", (req, res) => proxyOpenAI("/v1/chat/completions", req, res));
app.post("/v1/responses",       (req, res) => proxyOpenAI("/v1/responses", req, res));

app.listen(PORT, () => {
  console.log(`OpenAI proxy listening on http://localhost:${PORT}`);
  console.log(`CORS allow-origin: ${ALLOW_ORIGIN}`);
});
