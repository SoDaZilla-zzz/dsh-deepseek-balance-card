/**
 * dsh-liquid-glass-balance-card — host half.
 *
 * Registers local HTTP routes for the DSH web GUI:
 *
 *   GET  /api/liquid-glass-balance-card/settings
 *   POST /api/liquid-glass-balance-card/settings   ({action:'mutate', ops, expectedRevision})
 *   GET  /api/liquid-glass-balance-card/balance
 *   GET  /api/liquid-glass-balance-card/stats?range=today|yesterday|7d|30d|all
 *   GET  /api/liquid-glass-balance-card/online-stats?range=today|yesterday|7d|30d|all
 *
 * The manual API key is stored through the official credentials seam
 * (`ctx.credentials`, reference `DSH_LIQUID_GLASS_API_KEY`) — never written
 * to a plugin-owned plaintext file, and never sent back to the browser. If no
 * manual key is configured, the host falls back to the harness's own
 * `DEEPSEEK_API_KEY` credential, so the plugin also works out of the box for
 * users who already configured DeepSeek in Settings → Models.
 *
 * "总计（线上）" statistics come from DeepSeek's private platform dashboard
 * endpoints (`platform.deepseek.com/api/v0/usage/amount` and `.../cost`),
 * which a plain API key cannot authenticate. They require the optional
 * `DSH_LIQUID_GLASS_PLATFORM_TOKEN` credential — the `userToken` found in the
 * platform.deepseek.com localStorage of a signed-in browser session. It is
 * stored in the credentials seam like the API key and only ever sent to
 * platform.deepseek.com from the host.
 *
 * The settings route speaks the official plugin-card wire protocol (layered
 * value/base/user snapshot + revision-fenced field-level mutate ops), so the
 * browser half registers a first-party-style configuration card under
 * Settings → Plugins → 插件配置.
 *
 * Balance is fetched from DeepSeek's public `/user/balance` endpoint. The key
 * never leaves the machine; the browser only talks to these local routes.
 *
 * Cumulative usage stats are computed locally from DSH session logs using the
 * official DeepSeek pricing timeline (`lib/pricing.js`).
 */
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";
import { costOf, priceAt } from "./pricing.js";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { readFileSync, rmSync } from "node:fs";

export const name = "dsh-liquid-glass-balance-card";
export const inject = ["credentials", "settings"];

const PUBLIC_BASE_URL = "https://api.deepseek.com";
const BASE_URL_ENV = "DEEPSEEK_BASE_URL";
const BALANCE_PATH = "/user/balance";
const TIMEOUT_MS = 15000;
const HARNESS_CREDENTIAL_REF = credentialRef("DEEPSEEK_API_KEY");
const MANUAL_CREDENTIAL_REF = credentialRef("DSH_LIQUID_GLASS_API_KEY");
const MANUAL_REF_NAME = "DSH_LIQUID_GLASS_API_KEY";
const PLATFORM_TOKEN_REF = credentialRef("DSH_LIQUID_GLASS_PLATFORM_TOKEN");
const PLATFORM_REF_NAME = "DSH_LIQUID_GLASS_PLATFORM_TOKEN";
const STATE_FILE = "dsh-liquid-glass-balance-card.json";

/** Settings document namespace owned by this plugin (renders in the official plugin-configuration card). */
export const BALANCE_SETTINGS_NAMESPACE = settingsNamespace("liquid-glass-balance-card");

/** Visual configuration schema: the fields the plugin-configuration card edits. */
export const Config = z.object({
  refreshSeconds: z.number().default(60),
  // Online-totals refresh interval. The platform dashboard data lags behind
  // real usage and the "all" range walks several months, so the default is
  // 5 minutes rather than the balance's 60 s.
  onlineRefreshSeconds: z.number().default(300),
});

const SETTINGS_ROUTE = "/api/liquid-glass-balance-card/settings";
const BALANCE_ROUTE = "/api/liquid-glass-balance-card/balance";
const STATS_ROUTE = "/api/liquid-glass-balance-card/stats";
const ONLINE_STATS_ROUTE = "/api/liquid-glass-balance-card/online-stats";

/** DeepSeek platform dashboard endpoints (private; require the platform userToken). */
const PLATFORM_BASE_URL = "https://platform.deepseek.com";
const PLATFORM_USAGE_AMOUNT_PATH = "/api/v0/usage/amount";
const PLATFORM_USAGE_COST_PATH = "/api/v0/usage/cost";
const ONLINE_CACHE_TTL_MS = 45000;
const ONLINE_ALL_MONTHS_CAP = 36;
const ONLINE_BATCH_SIZE = 4;

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

// ---- legacy state migration (v0.1 kept the manual key in a plugin JSON) ----

/** Absolute path of the legacy state file (pre-credentials version). */
function legacyStatePath(ctx) {
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

/** One-time migration: move a legacy plaintext key into the credentials seam. */
async function migrateLegacyKey(ctx) {
  const path = legacyStatePath(ctx);
  let apiKey = null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed !== null && typeof parsed === "object" && typeof parsed.apiKey === "string" && parsed.apiKey !== "") {
      apiKey = parsed.apiKey;
    }
  } catch {
    return;
  }
  try {
    const existing = await ctx.credentials.resolve(MANUAL_CREDENTIAL_REF);
    if (existing === void 0 || typeof existing.value !== "string" || existing.value === "") {
      await ctx.credentials.set(MANUAL_CREDENTIAL_REF, apiKey);
    }
    rmSync(path, { force: true });
  } catch (error) {
    ctx.logger.warn("dsh-liquid-glass-balance-card: legacy key migration skipped");
    ctx.logger.warn(error);
  }
}

// ---- plugin-card settings protocol ------------------------------------------

/** Layered settings snapshot for the plugin card (value/base/user + credential view). */
async function settingsSnapshot(ctx) {
  const descriptor = ctx.settings.describe().find((row) => row.ns === BALANCE_SETTINGS_NAMESPACE);
  let manualInfo;
  let harnessInfo;
  let platformInfo;
  try {
    manualInfo = await ctx.credentials.describe(MANUAL_CREDENTIAL_REF);
  } catch {}
  try {
    harnessInfo = await ctx.credentials.describe(HARNESS_CREDENTIAL_REF);
  } catch {}
  try {
    platformInfo = await ctx.credentials.describe(PLATFORM_TOKEN_REF);
  } catch {}
  return {
    writable: ctx.settings.writable,
    settings: {
      value: descriptor?.value ?? {},
      revision: descriptor?.revision ?? 0,
      ...(descriptor?.base === undefined ? {} : { base: descriptor.base }),
      ...(descriptor?.user === undefined ? {} : { user: descriptor.user })
    },
    credential: {
      ref: MANUAL_REF_NAME,
      configured: manualInfo?.configured === true,
      source: manualInfo?.source,
      writable: manualInfo?.writable === true
    },
    platform: {
      ref: PLATFORM_REF_NAME,
      configured: platformInfo?.configured === true,
      source: platformInfo?.source,
      writable: platformInfo?.writable === true
    },
    harnessConfigured: harnessInfo?.configured === true
  };
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
    // `emptyDaily()` carries `date: ""` — spread it FIRST so the real date wins.
    map.set(date, { ...emptyDaily(), date });
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
    day = { ...emptyDaily(), date };
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

// ---- online usage stats (DeepSeek platform dashboard endpoints) ---------
//
// DeepSeek's public API only exposes /user/balance — there is no public usage
// endpoint. The platform web console (platform.deepseek.com/usage) reads the
// private dashboard endpoints below, authenticated with the `userToken` of a
// signed-in browser session (localStorage). A plain API key cannot read them,
// so these stats are optional: they light up only when the user configures the
// `DSH_LIQUID_GLASS_PLATFORM_TOKEN` credential.
//
//   GET /api/v0/usage/amount?month=<M>&year=<Y>  → per-day token amounts
//   GET /api/v0/usage/cost?month=<M>&year=<Y>    → per-day cost + currency
//
// Envelope: { code, data: { biz_code, biz_data } }. `biz_data` is an object
// for `amount` ({ total, days }) and an array of per-currency items for
// `cost`. Codes 40002 / 40003 mean the platform session expired. Amount items
// use types PROMPT_CACHE_HIT_TOKEN / PROMPT_CACHE_MISS_TOKEN /
// RESPONSE_TOKEN / REQUEST; cost items carry the same types minus REQUEST.
// These endpoints are private and may change without notice — parsing is kept
// defensive and failures degrade to "总计不可用" instead of breaking the card.

/**
 * 1-based month key of a timestamp in Beijing time (Asia/Shanghai). The
 * platform dashboard keys both its days and its monthly endpoints by Beijing
 * time, so the online aggregation must use Beijing day boundaries — the
 * machine-local calendar would shift today/yesterday by up to a day for
 * users outside UTC+8.
 */
function beijingMonthKey(timeMs) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit"
    }).formatToParts(new Date(timeMs));
    const value = (type) => Number(parts.find((part) => part.type === type)?.value ?? "0");
    return { year: value("year"), month: value("month") };
  } catch {
    const date = new Date(timeMs);
    return { year: date.getFullYear(), month: date.getMonth() + 1 };
  }
}

/** `YYYY-MM-DD` date key in Beijing time, shifted by `offsetDays`. */
function beijingDateKey(timeMs, offsetDays = 0) {
  const target = timeMs + offsetDays * 86400000;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date(target));
    const value = (type) => parts.find((part) => part.type === type)?.value ?? "";
    return `${value("year")}-${value("month")}-${value("day")}`;
  } catch {
    return localDateKey(target);
  }
}

/** Shift a month key by `delta` months. */
function addMonths(key, delta) {
  const total = key.year * 12 + (key.month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

/** Short stable hash for cache keys only (never logged, never sent anywhere). */
function shortHash(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

/** Resolve a range alias to an inclusive Beijing-time date-key window (`YYYY-MM-DD`). */
function rangeDateKeys(range, now = new Date()) {
  const nowMs = now.getTime();
  const today = beijingDateKey(nowMs);
  switch (range) {
    case "today": return { start: today, end: today };
    case "yesterday": {
      const yesterday = beijingDateKey(nowMs, -1);
      return { start: yesterday, end: yesterday };
    }
    case "7d": return { start: beijingDateKey(nowMs, -6), end: today };
    case "30d": return { start: beijingDateKey(nowMs, -29), end: today };
    case "all": return { start: "0000-00-00", end: today };
    default: return null;
  }
}

/**
 * Parse one platform usage payload. The `cost` endpoint returns one
 * `biz_data` entry per account currency, so parsing keeps every currency item
 * (`currencyItems`); the `amount` endpoint's `biz_data` is a single object and
 * yields one item without a currency. Returns `{ currencyItems }`,
 * `{ empty: true }` when there is nothing usable, or `{ authError: true }`
 * when the platform session is invalid/expired (40002 / 40003).
 */
function parsePlatformUsage(body) {
  if (body === null || typeof body !== "object") return { empty: true };
  if (body.code !== undefined && body.code !== 0) {
    if (body.code === 40002 || body.code === 40003) return { authError: true };
    return { empty: true };
  }
  const data = body.data;
  if (data === null || typeof data !== "object") return { empty: true };
  if (data.biz_code !== undefined && data.biz_code !== 0) {
    if (data.biz_code === 40002 || data.biz_code === 40003) return { authError: true };
    return { empty: true };
  }
  const raw = data.biz_data;
  if (raw === null || typeof raw !== "object") return { empty: true };
  const entries = Array.isArray(raw) ? raw : [raw];
  const currencyItems = entries
    .filter((item) => item !== null && typeof item === "object")
    .map((item) => ({
      days: Array.isArray(item.days) ? item.days : [],
      total: Array.isArray(item.total) ? item.total : [],
      currency: typeof item.currency === "string" && item.currency !== "" ? item.currency : null
    }));
  if (currencyItems.length === 0) return { empty: true };
  return { currencyItems };
}

/** Pick the currency item matching `preferredCurrency`, else the first one. */
function pickCurrencyItem(parsed, preferredCurrency) {
  const items = parsed.currencyItems ?? [];
  if (preferredCurrency !== null && preferredCurrency !== "") {
    const hit = items.find((item) => item.currency === preferredCurrency);
    if (hit !== void 0) return hit;
  }
  return items[0] ?? null;
}

/** A currency item with no days and no totals counts as empty. */
function usageItemEmpty(item) {
  return item === null || (item.days.length === 0 && item.total.length === 0);
}

/** Fetch one month of amount + cost usage concurrently from the platform. */
async function fetchPlatformMonth(token, key, preferredCurrency) {
  const query = `?month=${key.month}&year=${key.year}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "x-app-version": "1.0.0",
    Origin: PLATFORM_BASE_URL,
    Referer: `${PLATFORM_BASE_URL}/usage`
  };
  const [amountResponse, costResponse] = await Promise.all([
    fetch(`${PLATFORM_BASE_URL}${PLATFORM_USAGE_AMOUNT_PATH}${query}`, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    }),
    fetch(`${PLATFORM_BASE_URL}${PLATFORM_USAGE_COST_PATH}${query}`, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  ]);
  const [amountText, costText] = await Promise.all([amountResponse.text(), costResponse.text()]);
  if (!amountResponse.ok || !costResponse.ok) {
    throw new Error(`DeepSeek 平台用量接口返回 HTTP ${amountResponse.ok ? costResponse.status : amountResponse.status}`);
  }
  let amount;
  let cost;
  try {
    amount = parsePlatformUsage(JSON.parse(amountText));
    cost = parsePlatformUsage(JSON.parse(costText));
  } catch {
    throw new Error("DeepSeek 平台用量接口返回了无法解析的数据");
  }
  if (amount.authError === true || cost.authError === true) return { authError: true };
  // A month counts as empty when both payloads carry no days and no totals
  // (the platform returns `{ total: [], days: [] }` rather than omitting
  // `biz_data` for idle months).
  const amountItem = pickCurrencyItem(amount, preferredCurrency);
  const costItem = pickCurrencyItem(cost, preferredCurrency);
  const amountEmpty = usageItemEmpty(amountItem);
  const costEmpty = usageItemEmpty(costItem);
  if (amountEmpty && costEmpty) {
    return { amount: null, cost: null, empty: true, currency: costItem?.currency ?? null };
  }
  return {
    amount: amountEmpty ? null : amountItem,
    cost: costEmpty ? null : costItem,
    empty: false,
    currency: costItem?.currency ?? null
  };
}

function emptyOnlineDay() {
  return { date: "", calls: 0, cost: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, totalTokens: 0 };
}

/** Fold one month's amount + cost payloads into a date-keyed map. */
function foldPlatformMonth(dayMap, month) {
  const amount = month.amount;
  const cost = month.cost;
  if (amount !== null) {
    for (const day of amount.days) {
      if (day === null || typeof day !== "object" || typeof day.date !== "string") continue;
      let entry = dayMap.get(day.date);
      if (!entry) {
        entry = emptyOnlineDay();
        entry.date = day.date;
        dayMap.set(day.date, entry);
      }
      const models = Array.isArray(day.data) ? day.data : [];
      for (const model of models) {
        const items = model !== null && Array.isArray(model.usage) ? model.usage : [];
        for (const item of items) {
          if (item === null || typeof item !== "object") continue;
          const type = typeof item.type === "string" ? item.type.toUpperCase() : "";
          const value = Number(item.amount);
          if (!Number.isFinite(value)) continue;
          if (type === "REQUEST") entry.calls += value;
          else if (type === "PROMPT_CACHE_HIT_TOKEN") {
            entry.cacheReadTokens += value;
            entry.totalTokens += value;
          } else if (type === "PROMPT_CACHE_MISS_TOKEN") {
            entry.inputTokens += value;
            entry.totalTokens += value;
          } else if (type === "RESPONSE_TOKEN") {
            entry.outputTokens += value;
            entry.totalTokens += value;
          }
        }
      }
    }
  }
  if (cost !== null) {
    for (const day of cost.days) {
      if (day === null || typeof day !== "object" || typeof day.date !== "string") continue;
      let entry = dayMap.get(day.date);
      if (!entry) {
        entry = emptyOnlineDay();
        entry.date = day.date;
        dayMap.set(day.date, entry);
      }
      const models = Array.isArray(day.data) ? day.data : [];
      for (const model of models) {
        const items = model !== null && Array.isArray(model.usage) ? model.usage : [];
        for (const item of items) {
          if (item === null || typeof item !== "object") continue;
          const type = typeof item.type === "string" ? item.type.toUpperCase() : "";
          if (type === "REQUEST") continue;
          const value = Number(item.amount);
          if (!Number.isFinite(value)) continue;
          entry.cost += value;
        }
      }
    }
  }
}

/**
 * Aggregate platform usage into the same stats shape as the local
 * aggregation. `costUsd` is not derivable from the platform cost endpoint
 * (it reports a single account currency), so it stays null.
 */
async function buildOnlinePayload(range, token, preferredCurrency) {
  const now = new Date();
  const currentKey = beijingMonthKey(now.getTime());
  const months = [];
  let truncated = false;
  let authError = false;

  if (range === "all") {
    // Walk months backwards (newest first) until an empty month; batches of a
    // few months keep the request count bounded for old accounts.
    let cursor = currentKey;
    outer: while (months.length < ONLINE_ALL_MONTHS_CAP) {
      const batchKeys = [];
      for (let i = 0; i < ONLINE_BATCH_SIZE && months.length + batchKeys.length < ONLINE_ALL_MONTHS_CAP; i++) {
        batchKeys.push(cursor);
        cursor = addMonths(cursor, -1);
      }
      const batch = await Promise.all(batchKeys.map((key) => fetchPlatformMonth(token, key, preferredCurrency)));
      for (let i = 0; i < batch.length; i++) {
        const month = batch[i];
        if (month.authError === true) {
          authError = true;
          break outer;
        }
        months.push({ key: batchKeys[i], ...month });
      }
      if (batch[batch.length - 1].empty === true) break outer;
    }
    if (months.length >= ONLINE_ALL_MONTHS_CAP) truncated = true;
  } else {
    // Any 30-day window spans at most two calendar months.
    const startKey = addMonths(currentKey, -1);
    for (let key = startKey; ; key = addMonths(key, 1)) {
      const month = await fetchPlatformMonth(token, key, preferredCurrency);
      if (month.authError === true) {
        authError = true;
        break;
      }
      months.push({ key, ...month });
      if (key.year === currentKey.year && key.month === currentKey.month) break;
    }
  }

  if (authError) {
    return {
      available: false,
      reason: "platform-auth",
      message: "平台 Token 无效或已过期：请在 platform.deepseek.com 重新登录后更新 userToken（卡片设置 → 平台 Token）。"
    };
  }

  const dayMap = new Map();
  let currency = null;
  for (const month of months) {
    if (month.currency) currency = month.currency;
    foldPlatformMonth(dayMap, month);
  }

  const windowKeys = rangeDateKeys(range, now);
  const daily = [...dayMap.values()]
    .filter((day) => day.date >= windowKeys.start && day.date <= windowKeys.end)
    .sort((a, b) => a.date.localeCompare(b.date));

  const stats = emptyStats();
  for (const day of daily) {
    stats.calls += day.calls;
    stats.cost += day.cost;
    stats.inputTokens += day.inputTokens;
    stats.cacheReadTokens += day.cacheReadTokens;
    stats.outputTokens += day.outputTokens;
    stats.totalTokens += day.inputTokens + day.cacheReadTokens + day.outputTokens;
  }

  return {
    available: true,
    range,
    label: RANGE_ALIASES[range],
    currency: currency ?? null,
    monthCount: months.length,
    truncated,
    calls: roundTokens(stats.calls),
    cost: roundMoney(stats.cost),
    costUsd: null,
    inputTokens: roundTokens(stats.inputTokens),
    cacheReadTokens: roundTokens(stats.cacheReadTokens),
    outputTokens: roundTokens(stats.outputTokens),
    totalTokens: roundTokens(stats.totalTokens),
    daily: range === "7d" || range === "30d"
      ? daily.map((day) => ({
        date: day.date,
        calls: roundTokens(day.calls),
        cost: roundMoney(day.cost),
        costUsd: null,
        inputTokens: roundTokens(day.inputTokens),
        cacheReadTokens: roundTokens(day.cacheReadTokens),
        outputTokens: roundTokens(day.outputTokens),
        // `foldPlatformMonth` accumulates the buckets but not the total, so
        // derive it here — same arithmetic as the aggregate stats above.
        totalTokens: roundTokens(day.inputTokens + day.cacheReadTokens + day.outputTokens)
      }))
      : null
  };
}

/** Short-TTL in-memory cache for online stats (keyed by range + token hash). */
const onlineStatsCache = new Map();

/**
 * Collect online stats; degrades to `{ available: false, ... }` without a
 * token. `preferredCurrency` (from the balance API) is used to pick the
 * matching currency item when the platform cost payload carries several.
 * `force` bypasses the short-TTL cache (used by the manual refresh button).
 */
async function collectOnlineStats(ctx, range, preferredCurrency, force) {
  const tokenHit = await ctx.credentials.resolve(PLATFORM_TOKEN_REF);
  const token = tokenHit !== void 0 && typeof tokenHit.value === "string" ? tokenHit.value.trim() : "";
  if (token === "") {
    return {
      available: false,
      reason: "no-platform-token",
      message: "未配置平台 Token：在卡片设置（齿轮）或 设置 → 插件 → 插件配置 → DeepSeek 余额卡片 中填写 platform.deepseek.com 的 userToken，即可显示线上总计。"
    };
  }
  const cacheKey = `${range}:${shortHash(token)}:${preferredCurrency ?? ""}`;
  const cached = onlineStatsCache.get(cacheKey);
  if (force !== true && cached !== void 0 && Date.now() - cached.at < ONLINE_CACHE_TTL_MS) return cached.payload;
  const payload = await buildOnlinePayload(range, token, preferredCurrency);
  onlineStatsCache.set(cacheKey, { at: Date.now(), payload });
  return payload;
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

export async function apply(ctx, config = {}) {
  const settings = ctx.settings.register(BALANCE_SETTINGS_NAMESPACE, Config, {
    base: config,
    applies: "live"
  });
  void settings;
  migrateLegacyKey(ctx).catch(() => {});

  // Settings: official plugin-card wire protocol — GET layered snapshot,
  // POST revision-fenced field-level mutate ops. The manual key itself lives
  // in the credentials seam (never in settings and never on the wire back).
  registerRoute(ctx, "exact", SETTINGS_ROUTE, async (req, res) => {
    try {
      if (req.method === "POST") {
        const body = await readJsonBody(req);
        if (body?.action !== "mutate") {
          sendJson(res, 400, { ok: false, error: { message: "unknown action" } });
          return;
        }
        if (!ctx.settings.writable) throw new Error("settings provider is read-only");
        await ctx.settings.mutate(BALANCE_SETTINGS_NAMESPACE, Array.isArray(body.ops) ? body.ops : [], body.expectedRevision);
        sendJson(res, 200, { ok: true, value: await settingsSnapshot(ctx) });
        return;
      }
      if (req.method === "GET") {
        sendJson(res, 200, { ok: true, value: await settingsSnapshot(ctx) });
        return;
      }
      sendJson(res, 405, { ok: false, error: { message: "method not allowed" } });
    } catch (error) {
      ctx.logger.warn("dsh-liquid-glass-balance-card: settings route failed");
      ctx.logger.warn(error);
      sendJson(res, 400, {
        ok: false,
        error: { message: error instanceof Error ? error.message : String(error) }
      });
    }
  }, "dsh-liquid-glass-balance-card: settings route");

  // Balance: manual key first (credentials seam), harness DEEPSEEK_API_KEY as fallback.
  registerRoute(ctx, "exact", BALANCE_ROUTE, async (req, res) => {
    try {
      let apiKey = null;
      let source = "manual";
      const manual = await ctx.credentials.resolve(MANUAL_CREDENTIAL_REF);
      if (manual !== void 0 && typeof manual.value === "string" && manual.value !== "") {
        apiKey = manual.value;
      } else {
        const hit = await ctx.credentials.resolve(HARNESS_CREDENTIAL_REF);
        if (hit === void 0 || typeof hit.value !== "string" || hit.value === "") {
          sendJson(res, 503, {
            ok: false,
            error: "no-api-key",
            message: "未配置 DeepSeek API Key：请在 设置 → 插件 → 插件配置 → DeepSeek 余额卡片 中填写，或在 DSH 设置 → 模型中配置 DEEPSEEK_API_KEY。"
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
      ctx.logger.warn("dsh-liquid-glass-balance-card: failed to fetch DeepSeek balance");
      ctx.logger.warn(error);
      sendJson(res, 502, {
        ok: false,
        error: "fetch-failed",
        source: "manual",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }, "dsh-liquid-glass-balance-card: balance route");

  // Cumulative usage stats: local aggregation from DSH session logs.
  registerRoute(ctx, "exact", STATS_ROUTE, async (req, res) => {
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
      ctx.logger.warn("dsh-liquid-glass-balance-card: stats aggregation failed");
      ctx.logger.warn(error);
      sendJson(res, 500, {
        ok: false,
        error: "stats-failed",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }, "dsh-liquid-glass-balance-card: stats route");

  // Online totals: DeepSeek platform dashboard usage (requires the optional
  // platform `userToken` credential — a plain API key cannot read them).
  registerRoute(ctx, "exact", ONLINE_STATS_ROUTE, async (req, res) => {
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
      // The client forwards the balance currency so multi-currency accounts
      // get the matching platform cost item (bounded: currency codes are short).
      const rawCurrency = url.searchParams.get("currency") ?? "";
      const preferredCurrency = typeof rawCurrency === "string" && rawCurrency.length > 0 && rawCurrency.length <= 8 ? rawCurrency : null;
      const force = url.searchParams.get("force") === "1";
      const stats = await collectOnlineStats(ctx, range, preferredCurrency, force);
      sendJson(res, 200, { ok: true, ...stats });
    } catch (error) {
      ctx.logger.warn("dsh-liquid-glass-balance-card: online stats aggregation failed");
      ctx.logger.warn(error);
      sendJson(res, 502, {
        ok: false,
        error: "online-stats-failed",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }, "dsh-liquid-glass-balance-card: online stats route");
}
