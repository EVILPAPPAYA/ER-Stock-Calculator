/**
 * KILRR Stock Calculator — Unicommerce API Proxy
 * Runs on Render as a Web Service. Serves the static index.html
 * AND proxies Unicommerce API calls to avoid CORS issues.
 *
 * Environment variables (set in Render dashboard):
 *   UC_TENANT   = kilrr
 *   UC_USERNAME = dhruv@kilrr.com
 *   UC_PASSWORD = Dhruv@647
 *   PORT        = (Render sets this automatically)
 */

const express  = require("express");
const path     = require("path");
const https    = require("https");

const app  = express();
app.use(express.json());

// ── Config from env vars ──────────────────────────────────────────────────────
const TENANT   = process.env.UC_TENANT   || "kilrr";
const UC_USER  = process.env.UC_USERNAME || "";
const UC_PASS  = process.env.UC_PASSWORD || "";
const BASE_URL = `https://${TENANT}.unicommerce.com`;

// Facility codes exactly as they appear in Unicommerce
const FACILITIES = {
  BLR: "KILRR_B2B",
  KOL: "ER_kolkata",
  DEL: "ER_Delhi",
};

// ── Token cache (reuse until 5 min before expiry) ───────────────────────────
let tokenCache = { accessToken: null, expiresAt: 0 };

async function ucRequest(method, path, body, facilityCode) {
  const token = await getToken();
  const url = `${BASE_URL}${path}`;
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
  };
  if (facilityCode) headers["Facility"] = facilityCode;

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method,
      headers,
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function getToken() {
  const now = Date.now();
  if (tokenCache.accessToken && now < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  const url = `${BASE_URL}/oauth/token?grant_type=password&client_id=my-trusted-client`;
  const headers = {
    "Content-Type": "application/json",
    "username": UC_USER,
    "password": UC_PASS,
  };

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "GET",
      headers,
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (!json.access_token) {
            return reject(new Error("Auth failed: " + JSON.stringify(json)));
          }
          // Cache token, expire 5 min early to be safe
          tokenCache.accessToken = json.access_token;
          tokenCache.expiresAt   = now + (json.expires_in - 300) * 1000;
          resolve(json.access_token);
        } catch(e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// ── Helper: fetch all pages of sale orders for one facility ──────────────────
async function fetchOrdersForFacility(facilityCode, fromDate, toDate) {
  const items = [];
  let pageNumber = 0;
  const pageSize = 500;

  while (true) {
    const body = {
      fromDate,
      toDate,
      saleOrderItemStatuses: [
        "DISPATCHED", "DELIVERED", "SHIPPED",
        "RETURN_EXPECTED", "RETURNED",
        "PROCESSING", "INVOICED",
      ],
      pageNumber,
      pageSize,
    };

    const res = await ucRequest(
      "POST",
      "/services/rest/v1/oms/saleOrder/search",
      body,
      facilityCode
    );

    if (!res.body || !res.body.successful) break;

    const batch = res.body.saleOrderItems || res.body.elements || [];
    items.push(...batch);

    // Stop if we got fewer than a full page
    if (batch.length < pageSize) break;
    pageNumber++;
  }
  return items;
}

// ── /api/inventory — fetch inventory for all 3 ER facilities ────────────────
app.get("/api/inventory", async (req, res) => {
  try {
    const results = {};

    await Promise.all(
      Object.entries(FACILITIES).map(async ([cityKey, facilityCode]) => {
        const ucRes = await ucRequest(
          "POST",
          "/services/rest/v1/inventory/inventorySnapshot/get",
          { itemTypeSKUs: null, updatedSinceInMinutes: null },
          facilityCode
        );

        if (!ucRes.body || !ucRes.body.successful) {
          console.error(`Inventory fetch failed for ${facilityCode}:`, ucRes.body);
          results[cityKey] = [];
          return;
        }

        // inventorySnapshots is array of { itemTypeSKU, inventory, ... }
        results[cityKey] = (ucRes.body.inventorySnapshots || []).map(s => ({
          sku:      s.itemTypeSKU,
          name:     s.itemTypeName || s.itemTypeSKU,
          quantity: s.inventory || 0,
          facility: facilityCode,
        }));
      })
    );

    res.json({ success: true, data: results });
  } catch (err) {
    console.error("Inventory error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── /api/orders — fetch invoiced orders for last N days (default 7) ──────────
app.get("/api/orders", async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const toDate   = new Date();
    const fromDate = new Date(toDate - days * 24 * 60 * 60 * 1000);

    // Format: yyyy-MM-dd'T'HH:mm:ss
    const fmt = d => d.toISOString().slice(0, 19);
    const from = fmt(fromDate);
    const to   = fmt(toDate);

    const results = {};

    await Promise.all(
      Object.entries(FACILITIES).map(async ([cityKey, facilityCode]) => {
        const items = await fetchOrdersForFacility(facilityCode, from, to);
        results[cityKey] = {
          items,
          fromDate: from,
          toDate:   to,
          days,
          facility: facilityCode,
        };
      })
    );

    res.json({ success: true, data: results });
  } catch (err) {
    console.error("Orders error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── /api/ping — auth check ───────────────────────────────────────────────────
app.get("/api/ping", async (req, res) => {
  try {
    await getToken();
    res.json({ success: true, tenant: TENANT, message: "Unicommerce auth OK" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Serve static frontend ────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname)));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`KILRR proxy running on port ${PORT}`));
