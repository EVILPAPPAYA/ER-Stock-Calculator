/**
 * KILRR Stock Calculator — Unicommerce API Proxy
 * Node 18+ native fetch (no https module needed)
 *
 * Render env vars:
 *   UC_TENANT   = kilrr
 *   UC_USERNAME = dhruv@kilrr.com
 *   UC_PASSWORD = (your password)
 */

const express = require("express");
const path    = require("path");
const fs      = require("fs");

const app = express();
app.use(express.json());

const TENANT   = process.env.UC_TENANT   || "kilrr";
const UC_USER  = process.env.UC_USERNAME || "";
const UC_PASS  = process.env.UC_PASSWORD || "";
const BASE_URL = `https://${TENANT}.unicommerce.com`;

const FACILITIES = {
  BLR: "KILRR_B2B",
  KOL: "ER_kolkata",
  DEL: "ER_Delhi",
};

let tokenCache = { token: null, expiresAt: 0 };

// ── Auth ─────────────────────────────────────────────────────────────────────
async function getToken() {
  const now = Date.now();
  if (tokenCache.token && now < tokenCache.expiresAt) return tokenCache.token;

  const url = `${BASE_URL}/oauth/token` +
    `?grant_type=password` +
    `&client_id=my-trusted-client` +
    `&username=${encodeURIComponent(UC_USER)}` +
    `&password=${encodeURIComponent(UC_PASS)}`;

  console.log("Requesting UC token:", BASE_URL, "user:", UC_USER);

  const res = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  const text = await res.text();
  console.log("UC auth status:", res.status, "| body:", text.slice(0, 300));

  if (!res.ok) throw new Error(`UC auth failed (${res.status}): ${text.slice(0, 200)}`);

  const json = JSON.parse(text);
  if (!json.access_token) throw new Error("No access_token in response: " + text.slice(0, 200));

  tokenCache.token     = json.access_token;
  tokenCache.expiresAt = now + ((json.expires_in || 3600) - 300) * 1000;
  console.log("UC token OK, expires in", json.expires_in, "s");
  return tokenCache.token;
}

// ── Generic UC request ────────────────────────────────────────────────────────
async function ucReq(method, endpoint, body, facilityCode) {
  const token = await getToken();
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
  };
  if (facilityCode) headers["Facility"] = facilityCode;

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; }
  catch(e) { return { status: res.status, body: text }; }
}

// ── Routes ───────────────────────────────────────────────────────────────────
app.get("/api/ping", async (req, res) => {
  try {
    await getToken();
    res.json({ success: true, tenant: TENANT });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get("/api/inventory", async (req, res) => {
  try {
    const results = {};
    await Promise.all(Object.entries(FACILITIES).map(async ([city, fac]) => {
      const r = await ucReq(
        "POST",
        "/services/rest/v1/inventory/inventorySnapshot/get",
        { itemTypeSKUs: null, updatedSinceInMinutes: null },
        fac
      );
      console.log(`Inventory ${city} (${fac}):`, r.status,
        JSON.stringify(r.body).slice(0, 150));
      if (r.body && r.body.successful) {
        results[city] = (r.body.inventorySnapshots || []).map(s => ({
          sku: s.itemTypeSKU, name: s.itemTypeName || s.itemTypeSKU,
          quantity: s.inventory || 0,
        }));
      } else {
        results[city] = [];
      }
    }));
    res.json({ success: true, data: results });
  } catch(e) {
    console.error("Inventory error:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get("/api/orders", async (req, res) => {
  try {
    const days    = parseInt(req.query.days) || 7;
    const toDate  = new Date();
    const fromDate = new Date(toDate - days * 86400000);
    const fmt = d => d.toISOString().slice(0, 19);

    const results = {};
    await Promise.all(Object.entries(FACILITIES).map(async ([city, fac]) => {
      const items = [];
      let page = 0;
      while (true) {
        const r = await ucReq(
          "POST",
          "/services/rest/v1/oms/saleOrder/search",
          {
            fromDate: fmt(fromDate), toDate: fmt(toDate),
            saleOrderItemStatuses: [
              "DISPATCHED","DELIVERED","SHIPPED",
              "RETURN_EXPECTED","RETURNED","PROCESSING","INVOICED",
            ],
            pageNumber: page, pageSize: 500,
          },
          fac
        );
        console.log(`Orders ${city} page ${page}:`, r.status,
          JSON.stringify(r.body).slice(0, 150));
        if (!r.body || !r.body.successful) break;
        const batch = r.body.saleOrderItems || r.body.elements || [];
        items.push(...batch);
        if (batch.length < 500) break;
        page++;
      }
      results[city] = { items, fromDate: fmt(fromDate), toDate: fmt(toDate), days };
    }));
    res.json({ success: true, data: results });
  } catch(e) {
    console.error("Orders error:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Static ────────────────────────────────────────────────────────────────────
const STATIC_DIR = (() => {
  for (const d of [__dirname, path.join(__dirname,"src"), "/opt/render/project/src"]) {
    if (fs.existsSync(path.join(d, "index.html"))) { console.log("Static dir:", d); return d; }
  }
  return __dirname;
})();

const INDEX = path.join(STATIC_DIR, "index.html");
app.use(express.static(STATIC_DIR));
app.get("*", (req, res) => fs.existsSync(INDEX) ? res.sendFile(INDEX) : res.status(404).send("index.html not found"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`KILRR proxy on port ${PORT} | tenant: ${TENANT} | user: ${UC_USER ? "set" : "MISSING"}`);
});
