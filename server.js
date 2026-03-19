/**
 * KILRR Stock Calculator — Unicommerce API Proxy
 *
 * Credentials come from the browser Settings tab (passed in request body).
 * Env var fallbacks for headless/server use:
 *   UC_PASSWORD = your password   (recommended — keep out of browser storage)
 */

const express = require("express");
const path    = require("path");
const fs      = require("fs");

const app = express();
app.use(express.json());

// Defaults — overridden by request body from Settings tab
const DEFAULT_BASE_URL  = process.env.UC_BASE_URL  || "https://kilrr.unicommerce.co.in";
const DEFAULT_USER      = process.env.UC_USERNAME  || "anisha@kilrr.com";
const DEFAULT_PASS      = process.env.UC_PASSWORD  || "";
const DEFAULT_CLIENT_ID = process.env.UC_CLIENT_ID || "42aa72c5-a17d-42fb-a522-f3dd7fbe31e9";
const DEFAULT_FACILITIES = {
  BLR: process.env.FAC_BLR || "ER_Bangalore",
  KOL: process.env.FAC_KOL || "ER_Kolkata",
  DEL: process.env.FAC_DEL || "ER_Delhi",
};

// ── Flavour keyword matcher ────────────────────────────────────────────────────
const FLAVOUR_MAP = [
  { short:"KM",         keywords:["saza","kaali","mirch"] },
  { short:"AFG",        keywords:["afghan","shaitaan"] },
  { short:"LK",         keywords:["lucknowi","tamancha"] },
  { short:"TAN",        keywords:["tandoori","blast"] },
  { short:"DH",         keywords:["dhaniya","mirchi","woh"] },
  { short:"GOA",        keywords:["gangs","awadh"] },
  { short:"Pesto",      keywords:["pistol","pesto"] },
  { short:"Peri",       keywords:["bloody","peri"] },
  { short:"Achari",     keywords:["achaari","atyachaari","achari"] },
  { short:"Pudina",     keywords:["paapi","pudina"] },
  { short:"Shwarma",    keywords:["shawarma","beta"] },
  { short:"Curry 9211", keywords:["curry","9211","9 2 11"] },
  { short:"KMH",        keywords:["kaalimirch","hadd","haddcurry"] },
  { short:"Palak",      keywords:["palak","panchnama"] },
];

function matchFlavour(val) {
  if (!val) return null;
  const low = String(val).toLowerCase().trim();
  const exact = FLAVOUR_MAP.find(f => f.short.toLowerCase() === low);
  if (exact) return exact.short;
  let best = null, score = 0;
  for (const f of FLAVOUR_MAP) {
    let s = 0;
    for (const kw of f.keywords) if (low.includes(kw)) s++;
    if (s > score) { score = s; best = f.short; }
  }
  return score > 0 ? best : null;
}

const SHIPPED_STATUSES = [
  "DISPATCHED","DELIVERED","SHIPPED","RETURN_EXPECTED","RETURNED",
  "PROCESSING","INVOICED","PACKED","READY_TO_SHIP",
];

// ── Per-request config helper ─────────────────────────────────────────────────
// Reads credentials from request body (from browser Settings), falls back to env
function getConfig(body = {}) {
  return {
    baseUrl:    body.ucBaseUrl    || DEFAULT_BASE_URL,
    user:       body.ucUsername   || DEFAULT_USER,
    pass:       body.ucPassword   || DEFAULT_PASS,
    clientId:   body.ucClientId   || DEFAULT_CLIENT_ID,
    facilities: body.facilities   || DEFAULT_FACILITIES,
  };
}

// ── Token cache — keyed by user so different accounts don't collide ───────────
const tokenCache = {};

async function getToken(cfg) {
  const key = `${cfg.baseUrl}::${cfg.user}`;
  const now = Date.now();
  if (tokenCache[key]?.token && now < tokenCache[key].expiresAt) return tokenCache[key].token;

  if (!cfg.pass) throw new Error("Password not set — enter it in the Settings tab");

  const url = `${cfg.baseUrl}/oauth/token` +
    `?grant_type=password` +
    `&client_id=${encodeURIComponent(cfg.clientId)}` +
    `&username=${encodeURIComponent(cfg.user)}` +
    `&password=${encodeURIComponent(cfg.pass)}`;

  console.log("[UC] Auth →", cfg.baseUrl, "user:", cfg.user);
  const res  = await fetch(url, { method: "GET", headers: { "Content-Type": "application/json" } });
  const text = await res.text();

  if (!res.ok) throw new Error(`Auth failed (${res.status}): ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  if (!json.access_token) throw new Error("No access_token in response");

  tokenCache[key] = { token: json.access_token, expiresAt: now + ((json.expires_in || 3600) - 300) * 1000 };
  console.log("[UC] Token OK, expires in", json.expires_in, "s");
  return json.access_token;
}

// ── Generic UC request ────────────────────────────────────────────────────────
async function ucReq(cfg, method, endpoint, body, facilityCode) {
  const token = await getToken(cfg);
  const headers = { "Content-Type": "application/json", "Authorization": `Bearer ${token}` };
  if (facilityCode) headers["Facility"] = facilityCode;

  const res  = await fetch(`${cfg.baseUrl}${endpoint}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try   { return { status: res.status, ok: res.ok, body: JSON.parse(text) }; }
  catch { return { status: res.status, ok: res.ok, body: text }; }
}

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ── /api/ping — test credentials ──────────────────────────────────────────────
app.post("/api/ping", async (req, res) => {
  try {
    const cfg = getConfig(req.body);
    await getToken(cfg);
    res.json({ success: true, baseUrl: cfg.baseUrl, user: cfg.user });
  } catch(e) {
    res.status(401).json({ success: false, error: e.message });
  }
});
app.get("/api/ping", async (req, res) => {
  try {
    const cfg = getConfig();
    await getToken(cfg);
    res.json({ success: true, baseUrl: cfg.baseUrl, user: cfg.user });
  } catch(e) {
    res.status(401).json({ success: false, error: e.message });
  }
});

// ── /api/inventory ────────────────────────────────────────────────────────────
async function fetchInventory(cfg) {
  const result = { BLR: {}, KOL: {}, DEL: {} };
  const warnings = [];
  const syncLogRows = [];

  await Promise.all(Object.entries(cfg.facilities).map(async ([city, fac]) => {
    try {
      const r = await ucReq(cfg, "POST",
        "/services/rest/v1/inventory/inventorySnapshot/get",
        { itemTypeSKUs: null, updatedSinceInMinutes: null },
        fac
      );
      console.log(`[UC] Inventory ${city} (${fac}): HTTP ${r.status}`);

      if (!r.ok || !r.body?.successful) {
        const msg = typeof r.body === "string" ? r.body.slice(0,200) : (r.body?.message || "API unsuccessful");
        warnings.push(`${city} (${fac}): ${msg}`);
        return;
      }

      const snapshots = r.body.inventorySnapshots || [];
      for (const snap of snapshots) {
        const short = matchFlavour(snap.itemTypeSKU) || matchFlavour(snap.itemTypeName);
        if (!short) continue;
        result[city][short] = (result[city][short] || 0) + (snap.inventory || 0);
      }
      console.log(`[UC] Inventory ${city}: ${Object.keys(result[city]).length} SKUs mapped from ${snapshots.length} snapshots`);
      if (snapshots.length === 0) console.log(`[UC] WARN: 0 snapshots for ${city} — check facility code "${fac}"`);
      if (unmatched.length) console.log(`[UC] Unmatched in ${city}:`, unmatched.slice(0,10));
      syncLogRows.push({
        syncType: "inventory", city, facility: fac,
        apiStatus: "200", totalItems: snapshots.length,
        matchedSkus: Object.keys(result[city]).length,
        unmatchedSkus: unmatched.length,
        unmatchedSample: unmatched.slice(0,5),
        mappedData: Object.entries(result[city]).map(([k,v]) => k+":"+v).join(", "),
      });
    } catch(e) {
      warnings.push(`${city}: ${e.message}`);
      syncLogRows.push({ syncType:"inventory", city, facility:fac, apiStatus:"error", totalItems:0, matchedSkus:0, unmatchedSkus:0, unmatchedSample:[], mappedData: e.message });
    }
  }));

  if (syncLogRows.length && cfg.sheetUrl) {
    postToSheet(cfg.sheetUrl, "logUCSync", { rows: syncLogRows });
  }
  return { inventory: result, warnings };
}

app.post("/api/inventory", async (req, res) => {
  try {
    const cfg = getConfig(req.body);
    const data = await fetchInventory(cfg);
    res.json({ success: true, ...data });
  } catch(e) {
    console.error("[UC] Inventory error:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});
app.get("/api/inventory", async (req, res) => {
  try {
    const cfg = getConfig();
    const data = await fetchInventory(cfg);
    res.json({ success: true, ...data });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── /api/orders ───────────────────────────────────────────────────────────────
async function fetchOrders(cfg, days) {
  const toDate   = new Date();
  const fromDate = new Date(toDate - days * 86400000);
  const fmt      = d => d.toISOString().slice(0, 19);
  const fromStr  = fmt(fromDate), toStr = fmt(toDate);

  const result = { BLR: {}, KOL: {}, DEL: {} };
  const warnings = [];
  const syncLogRows = [];

  await Promise.all(Object.entries(cfg.facilities).map(async ([city, fac]) => {
    try {
      const items = [];
      let page = 0;
      while (true) {
        const r = await ucReq(cfg, "POST",
          "/services/rest/v1/oms/saleOrder/search",
          { fromDate: fromStr, toDate: toStr, saleOrderItemStatuses: SHIPPED_STATUSES, pageNumber: page, pageSize: 500 },
          fac
        );
        console.log(`[UC] Orders ${city} page ${page}: HTTP ${r.status}`);
        if (!r.ok || !r.body?.successful) {
          const msg = typeof r.body === "string" ? r.body.slice(0,200) : (r.body?.message || "API unsuccessful");
          warnings.push(`${city} orders: ${msg}`); break;
        }
        const batch = r.body.saleOrderItems || r.body.elements || [];
        items.push(...batch);
        if (batch.length < 500) break;
        page++;
      }

      const counts = {};
      const orderUnmatched = new Set();
      for (const item of items) {
        const skuName = item.itemTypeSKU || item.itemSKU || item.sku || "";
        const short   = matchFlavour(skuName) || matchFlavour(item.itemTypeName);
        if (!short) { orderUnmatched.add(skuName || item.itemTypeName || "?"); continue; }
        counts[short] = (counts[short] || 0) + (item.quantity || item.qty || 1);
      }
      if (orderUnmatched.size) console.log(`[UC] Orders ${city} unmatched:`, [...orderUnmatched].slice(0,10));
      for (const [short, total] of Object.entries(counts)) {
        result[city][short] = { total, days, daily: Math.ceil(total / days) };
      }
      console.log(`[UC] Orders ${city}: ${items.length} items → ${Object.keys(counts).length} SKUs`);
      syncLogRows.push({
        syncType: "orders-" + days + "d", city, facility: fac,
        apiStatus: "200", totalItems: items.length,
        matchedSkus: Object.keys(counts).length,
        unmatchedSkus: orderUnmatched.size,
        unmatchedSample: [...orderUnmatched].slice(0,5),
        mappedData: Object.entries(counts).map(([k,v]) => k+":"+v).join(", "),
      });
    } catch(e) {
      warnings.push(`${city}: ${e.message}`);
      syncLogRows.push({ syncType:"orders-"+days+"d", city, facility:fac, apiStatus:"error", totalItems:0, matchedSkus:0, unmatchedSkus:0, unmatchedSample:[], mappedData: e.message });
    }
  }));

  if (syncLogRows.length && cfg.sheetUrl) {
    postToSheet(cfg.sheetUrl, "logUCSync", { rows: syncLogRows });
  }
  return { demand: result, days, isSingleDay: days === 1,
    dateRange: `${fromStr.slice(0,10)} → ${toStr.slice(0,10)} (${days} day${days>1?"s":""})`, warnings };
}

app.post("/api/orders", async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days || req.body.days) || 7, 90);
    const cfg  = getConfig(req.body);
    const data = await fetchOrders(cfg, days);
    res.json({ success: true, ...data });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});
app.get("/api/orders", async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 7, 90);
    const cfg  = getConfig();
    const data = await fetchOrders(cfg, days);
    res.json({ success: true, ...data });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── /api/uc-data — inventory + orders in one call ─────────────────────────────
app.post("/api/uc-data", async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days || req.body.days) || 1, 90);
    const cfg  = getConfig(req.body);
    const [inv, ord] = await Promise.all([fetchInventory(cfg), fetchOrders(cfg, days)]);
    res.json({
      success: true,
      inventory: inv.inventory,
      demand:    ord.demand,
      days:      ord.days,
      isSingleDay: ord.isSingleDay,
      dateRange: ord.dateRange,
      warnings:  [...inv.warnings, ...ord.warnings],
    });
  } catch(e) {
    console.error("[UC] uc-data error:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});
app.get("/api/uc-data", async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 1, 90);
    const cfg  = getConfig();
    const [inv, ord] = await Promise.all([fetchInventory(cfg), fetchOrders(cfg, days)]);
    res.json({ success: true, inventory: inv.inventory, demand: ord.demand,
      days: ord.days, isSingleDay: ord.isSingleDay, dateRange: ord.dateRange,
      warnings: [...inv.warnings, ...ord.warnings] });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── /api/debug — see raw UC fields to diagnose SKU matching ─────────────────
app.get("/api/debug", async (req, res) => {
  try {
    const cfg = getConfig();
    const token = await getToken(cfg);
    const results = {};
    for (const [city, fac] of Object.entries(cfg.facilities)) {
      const r = await fetch(`${cfg.baseUrl}/services/rest/v1/inventory/inventorySnapshot/get`, {
        method: "POST",
        headers: { "Content-Type":"application/json", "Authorization":`Bearer ${token}`, "Facility":fac },
        body: JSON.stringify({ itemTypeSKUs: null, updatedSinceInMinutes: null }),
      });
      const body = await r.json().catch(() => ({}));
      const snaps = body.inventorySnapshots || [];
      results[city] = {
        facility: fac, httpStatus: r.status, apiSuccessful: body.successful,
        totalSnapshots: snaps.length,
        sample: snaps.slice(0,8).map(s => ({
          itemTypeSKU: s.itemTypeSKU, itemTypeName: s.itemTypeName,
          inventory: s.inventory,
          matched: matchFlavour(s.itemTypeSKU)||matchFlavour(s.itemTypeName)||"NO MATCH"
        })),
      };
    }
    res.json({ success:true, results });
  } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── Static ────────────────────────────────────────────────────────────────────
const STATIC_DIR = (() => {
  for (const d of [__dirname, path.join(__dirname,"src"), "/opt/render/project/src"]) {
    if (fs.existsSync(path.join(d, "index.html"))) { console.log("[Static]", d); return d; }
  }
  return __dirname;
})();

app.use(express.static(STATIC_DIR));
app.get("*", (req, res) => {
  const idx = path.join(STATIC_DIR, "index.html");
  fs.existsSync(idx) ? res.sendFile(idx) : res.status(404).send("index.html not found");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(
  `KILRR :${PORT} | ${DEFAULT_BASE_URL} | ${DEFAULT_USER} | pass:${DEFAULT_PASS?"SET":"use Settings tab"}`
));
