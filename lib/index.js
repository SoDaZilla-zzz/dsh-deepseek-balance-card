/**
 * dsh-deepseek-balance-card — host half.
 *
 * Registers local HTTP routes for the DSH web GUI:
 *
 *   GET  /api/deepseek-balance-card/settings
 *   POST /api/deepseek-balance-card/settings
 *   GET  /api/deepseek-balance-card/balance
 *   GET  /api/deepseek-balance-card/stats?range=today|yesterday|7d|30d|all
 *
 * The API key can be entered manually in the card's settings popover. It is
 * stored on the host under `$DSH_HOME/storages/dsh-deepseek-balance-card.json`
 * and never sent back to the browser. If no manual key is configured, the host
 * falls back to the harness's own `DEEPSEEK_API_KEY` credential, so the plugin
 * also works out of the box for users who already configured DeepSeek in
 * Settings → Models.
 *
 * Balance is fetched from DeepSeek's public `/user/balance` endpoint. The key
 * never leaves the machine; the browser only talks to these local routes.
 *
 * Cumulative usage stats are computed locally from DSH session logs using the
 * official DeepSeek pricing timeline (`lib/pricing.js`).
 */
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { costOf, priceAt } from "./pricing.js";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync, rmSync } from "node:fs";

export const name = "dsh-deepseek-balance-card";
export const inject = ["credentials"];

const PUBLIC_BASE_URL = "https://api.deepseek.com";
const BASE_URL_ENV = "DEEPSEEK_BASE_URL";
const BALANCE_PATH = "/user/balance";
const TIMEOUT_MS = 15000;
const STATE_FILE = "dsh-deepseek-balance-card.json";
const CREDENTIAL_REF = credentialRef("DEEPSEEK_API_KEY");

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function balanceUrl() {
  const base = process.env[BASE_URL_ENV] ?? PUBLIC_BASE_URL;
  return `${base.replace(/\/+$/, "")}${BALANCE_PATH}`;
}

function sendJson(res, status, body) {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(body));
}

/** Read a JSON request body (small size limit). */
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) {
      const error = new Error("request body too large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Extract a readable provider message from a DeepSeek error body. */
function providerMessage(text, status) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.error === "object" && parsed.error !== null && typeof parsed.error.message === "string") {
      return parsed.error.message;
    }
  } catch {}
  return `DeepSeek 接口返回 HTTP ${status}`;
}

// ---- manual key storage -------------------------------------------------

/** Absolute path of the plugin state file under the DSH home. */
function statePath(ctx) {
  let storages;
  const homeFn = typeof ctx.get === "function" ? ctx.get("dshHomePath") : void 0;
  if (typeof homeFn === "function") {
    storages = homeFn("storages");
  } else if (process.env.DSH_HOME) {
    storages = join(process.env.DSH_HOME, "storages");
  } else {
    storages = join(homedir(), ".dsh", "storages");
  }
  return join(storages, STATE_FILE);
}

function readState(ctx) {
  try {
    const parsed = JSON.parse(readFileSync(statePath(ctx), "utf8"));
    if (parsed !== null && typeof parsed === "object" && typeof parsed.apiKey === "string" && parsed.apiKey !== "") {
      return parsed;
    }
  } catch {}
  return null;
}

function writeState(ctx, apiKey) {
  const path = statePath(ctx);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify({ apiKey }), "utf8");
  try {
    chmodSync(tmp, 0o600);
  } catch {}
  renameSync(tmp, path);
}

function clearState(ctx) {
  try {
    rmSync(statePath(ctx), { force: true });
  } catch {}
}

/** Mask a key for display in the settings popover. */
function maskKey(key) {
  if (typeof key !== "string" || key.length <= 8) return "••••••••";
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
}

// ---- cumulative usage stats ----------------------------------------------

const RANGE_ALIASES = {
  today: "今天",
  yesterday: "昨天",
  "7d": "近7天",
  "30d": "近30天",
  all: "全部"
};

/** Local calendar day start, shifted by `offsetDays` (e.g. -1 = yesterday). */
function startOfLocalDay(offsetDays = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.getTime();
}

/** Resolve a range alias to a [start, end) window in epoch ms. */
function rangeWindow(range) {
  switch (range) {
    case "today":
      return { start: startOfLocalDay(0), end: Infinity };
    case "yesterday":
      return { start: startOfLocalDay(-1), end: startOfLocalDay(0) };
    case "7d":
      return { start: startOfLocalDay(-6), end: Infinity };
    case "30d":
      return { start: startOfLocalDay(-29), end: Infinity };
    case "all":
      return { start: 0, end: Infinity };
    default:
      return null;
  }
}

function emptyStats() {
  return {
    calls: 0,
    cost: 0,
    costUsd: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    totalTokens: 0
  };
}

function roundMoney(value) {
  return Math.round(value * 1e6) / 1e6;
}

function roundTokens(value) {
  return Math.round(value);
}

function eventInRange(event, window) {
  if (!event || typeof event !== "object") return false;
  const time = typeof event.time === "number" ? event.time : Date.now();
  return time >= window.start && time < window.end;
}

function priceEventIntoStats(stats, event) {
  const data = event.data;
  const usage = data && data.usage;
  if (!usage || typeof usage !== "object") return false;
  if (typeof usage.inputTokens !== "number" && typeof usage.outputTokens !== "number") return false;
  const model =
    data && data.message && typeof data.message.source === "object" && data.message.source !== null && typeof data.message.source.model === "string"
      ? data.message.source.model
      : "unknown";
  const unit = priceAt(model, event.time ?? Date.now());
  const sample = costOf(usage, unit);
  stats.calls += 1;
  stats.cost += sample.cost;
  stats.costUsd += sample.costUsd;
  stats.inputTokens += sample.inputTokens;
  stats.cacheReadTokens += sample.cacheReadTokens;
  stats.outputTokens += sample.outputTokens;
  stats.totalTokens += sample.inputTokens + sample.cacheReadTokens + sample.outputTokens;
  return true;
}

function localDateKey(time) {
  const d = new Date(time);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function emptyDaily() {
  return {
    date: "",
    calls: 0,
    cost: 0,
    costUsd: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    totalTokens: 0
  };
}

function createDailyMap(range) {
  const days = range === "7d" ? 7 : 30;
  const map = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const time = startOfLocalDay(-i);
    const date = localDateKey(time);
    map.set(date, { date, ...emptyDaily() });
  }
  return map;
}

function priceEventIntoDaily(dailyMap, event) {
  const data = event.data;
  const usage = data && data.usage;
  if (!usage || typeof usage !== "object") return false;
  if (typeof usage.inputTokens !== "number" && typeof usage.outputTokens !== "number") return false;
  const time = typeof event.time === "number" ? event.time : Date.now();
  const date = localDateKey(time);
  let day = dailyMap.get(date);
  if (!day) {
    day = { date, ...emptyDaily() };
    dailyMap.set(date, day);
  }
  const model =
    data && data.message && typeof data.message.source === "object" && data.message.source !== null && typeof data.message.source.model === "string"
      ? data.message.source.model
      : "unknown";
  const unit = priceAt(model, time);
  const sample = costOf(usage, unit);
  day.calls += 1;
  day.cost += sample.cost;
  day.costUsd += sample.costUsd;
  day.inputTokens += sample.inputTokens;
  day.cacheReadTokens += sample.cacheReadTokens;
  day.outputTokens += sample.outputTokens;
  day.totalTokens += sample.inputTokens + sample.cacheReadTokens + sample.outputTokens;
  return true;
}

/**
 * Aggregate cumulative consumption from all DSH session logs. Live sessions
 * are read from memory to avoid missing unflushed events; persisted sessions
 * are read from `sessionPersistence` raw JSONL logs.
 */
async function collectStats(ctx, range) {
  const window = rangeWindow(range);
  if (!window) throw new Error(`unknown range: ${range}`);
  const stats = emptyStats();
  const dailyEnabled = range === "7d" || range === "30d";
  const dailyMap = dailyEnabled ? createDailyMap(range) : null;
  const addEvent = (event) => {
    if (event && event.type === "assistant/message" && eventInRange(event, window)) {
      priceEventIntoStats(stats, event);
      if (dailyMap) priceEventIntoDaily(dailyMap, event);
    }
  };

  const persistence = ctx.get("sessionPersistence");
  const liveStore = ctx.get("sessions");
  const liveById = new Map();
  if (liveStore && typeof liveStore.list === "function") {
    for (const session of liveStore.list()) {
      if (session && typeof session.id === "string") liveById.set(session.id, session);
    }
  }

  if (persistence && typeof persistence.listSnapshots === "function") {
    let snapshots = [];
    try {
      snapshots = await persistence.listSnapshots();
    } catch {}
    for (const snap of snapshots) {
      const id = snap && snap.header && snap.header.id ? snap.header.id : null;
      if (!id) continue;
      const live = liveById.get(id);
      if (live) {
        for (const event of live.events ?? []) {
          addEvent(event);
        }
        liveById.delete(id);
        continue;
      }
      try {
        const raw = await persistence.readRaw(id);
        if (raw && typeof raw.content === "string") {
          for (const line of raw.content.split("\n")) {
            if (line === "") continue;
            let event;
            try {
              event = JSON.parse(line);
            } catch {
              continue;
            }
            addEvent(event);
          }
        }
      } catch {}
    }
  }

  // Live sessions not yet materialized in persistence are counted as well.
  for (const session of liveById.values()) {
    for (const event of session.events ?? []) {
      addEvent(event);
    }
  }

  stats.cost = roundMoney(stats.cost);
  stats.costUsd = roundMoney(stats.costUsd);
  stats.inputTokens = roundTokens(stats.inputTokens);
  stats.cacheReadTokens = roundTokens(stats.cacheReadTokens);
  stats.outputTokens = roundTokens(stats.outputTokens);
  stats.totalTokens = roundTokens(stats.totalTokens);

  if (dailyMap) {
    const daily = [...dailyMap.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        ...d,
        cost: roundMoney(d.cost),
        costUsd: roundMoney(d.costUsd),
        inputTokens: roundTokens(d.inputTokens),
        cacheReadTokens: roundTokens(d.cacheReadTokens),
        outputTokens: roundTokens(d.outputTokens),
        totalTokens: roundTokens(d.totalTokens)
      }));
    return { ...stats, daily };
  }
  return { ...stats, daily: null };
}

// ---- route registration (webServer/httpServer compatibility) ------------

function registerRoute(ctx, kind, path, handler, label) {
  let done = false;
  const doRegister = (server) => {
    if (done || !server || typeof server.register !== "function") return;
    done = true;
    ctx.effect(() => server.register({ kind, path, handler }), label);
  };
  const existing = ctx.get("webServer") ?? ctx.get("httpServer");
  if (existing) {
    doRegister(existing);
    return;
  }
  const listener = (serviceName) => {
    if (serviceName === "webServer" || serviceName === "httpServer") {
      doRegister(ctx.get(serviceName));
    }
  };
  ctx.on("internal/service", listener);
  ctx.effect(() => () => ctx.off("internal/service", listener), `${label}: service listener`);
}

// ---- plugin body ---------------------------------------------------------

export function apply(ctx) {
  // Settings: report whether a manual key is configured and whether the
  // harness-level DEEPSEEK_API_KEY fallback exists.
  registerRoute(ctx, "exact", "/api/deepseek-balance-card/settings", async (req, res) => {
    try {
      if (req.method === "POST") {
        const body = await readJsonBody(req);
        if (body.clear === true || typeof body.apiKey !== "string" || body.apiKey.trim() === "") {
          clearState(ctx);
        } else {
          writeState(ctx, body.apiKey.trim());
        }
        sendJson(res, 200, { ok: true });
        return;
      }

      const manual = readState(ctx);
      let harnessConfigured = false;
      try {
        const hit = await ctx.credentials.resolve(CREDENTIAL_REF);
        harnessConfigured = hit !== void 0 && typeof hit.value === "string" && hit.value !== "";
      } catch {}
      sendJson(res, 200, {
        ok: true,
        manualConfigured: manual !== null,
        maskedKey: manual ? maskKey(manual.apiKey) : null,
        harnessConfigured
      });
    } catch (error) {
      ctx.logger.warn("dsh-deepseek-balance-card: settings route failed");
      ctx.logger.warn(error);
      const status = error && error.status ? error.status : 500;
      sendJson(res, status, {
        ok: false,
        error: "settings-failed",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }, "dsh-deepseek-balance-card: settings route");

  // Balance: manual key first, harness DEEPSEEK_API_KEY as fallback.
  registerRoute(ctx, "exact", "/api/deepseek-balance-card/balance", async (req, res) => {
    try {
      const manual = readState(ctx);
      let apiKey = manual ? manual.apiKey : null;
      let source = "manual";
      if (!apiKey) {
        const hit = await ctx.credentials.resolve(CREDENTIAL_REF);
        if (hit === void 0 || typeof hit.value !== "string" || hit.value === "") {
          sendJson(res, 503, {
            ok: false,
            error: "no-api-key",
            message: "未配置 DeepSeek API Key：请在卡片设置中手动填写，或在 DSH 设置 → 模型中配置 DEEPSEEK_API_KEY。"
          });
          return;
        }
        apiKey = hit.value;
        source = "harness";
      }

      const response = await fetch(balanceUrl(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json"
        },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      const text = await response.text();
      if (!response.ok) {
        sendJson(res, response.status, {
          ok: false,
          error: "provider",
          source,
          message: providerMessage(text, response.status)
        });
        return;
      }
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {}
      sendJson(res, 200, { ok: true, source, balance: body });
    } catch (error) {
      ctx.logger.warn("dsh-deepseek-balance-card: failed to fetch DeepSeek balance");
      ctx.logger.warn(error);
      sendJson(res, 502, {
        ok: false,
        error: "fetch-failed",
        source: "manual",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }, "dsh-deepseek-balance-card: balance route");

  // Cumulative usage stats: local aggregation from DSH session logs.
  registerRoute(ctx, "exact", "/api/deepseek-balance-card/stats", async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      const range = url.searchParams.get("range") ?? "today";
      if (!RANGE_ALIASES[range]) {
        sendJson(res, 400, {
          ok: false,
          error: "bad-range",
          message: `未知时间范围：${range}（可选 today / yesterday / 7d / 30d / all）`
        });
        return;
      }
      const stats = await collectStats(ctx, range);
      sendJson(res, 200, {
        ok: true,
        range,
        label: RANGE_ALIASES[range],
        ...stats
      });
    } catch (error) {
      ctx.logger.warn("dsh-deepseek-balance-card: stats aggregation failed");
      ctx.logger.warn(error);
      sendJson(res, 500, {
        ok: false,
        error: "stats-failed",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }, "dsh-deepseek-balance-card: stats route");
}
