import { useState, useMemo, useRef, useCallback } from "react";
import * as XLSX from "xlsx";

const FLAVOUR_MAP = [
  { short:"KM",         full:"Saza-E-KaaliMirch",        keywords:["saza","kaali","mirch"] },
  { short:"AFG",        full:"Afghan-Ka-Shaitaan",        keywords:["afghan","shaitaan"] },
  { short:"LK",         full:"Lucknowi Tamancha",         keywords:["lucknowi","tamancha"] },
  { short:"TAN",        full:"Tandoori Blast",            keywords:["tandoori","blast"] },
  { short:"DH",         full:"Dhaniya Mirchi Aur Woh",    keywords:["dhaniya","mirchi","woh"] },
  { short:"GOA",        full:"Gangs of Awadh",            keywords:["gangs","awadh"] },
  { short:"Pesto",      full:"Pistol Pesto",              keywords:["pistol","pesto"] },
  { short:"Peri",       full:"Bloody Peri",               keywords:["bloody","peri"] },
  { short:"Achari",     full:"Achaari Atyachaari",        keywords:["achaari","atyachaari","achari"] },
  { short:"Pudina",     full:"Paapi Pudina",              keywords:["paapi","pudina"] },
  { short:"Shwarma",    full:"Shawarma Ji Ka Beta",       keywords:["shawarma","beta"] },
  { short:"Curry 9211", full:"CURRY NO. 9 2 11",          keywords:["curry","9211","9 2 11"] },
  { short:"KMH",        full:"KAALIMIRCH KI HADDCURRY",  keywords:["kaalimirch","hadd","haddcurry"] },
  { short:"Palak",      full:"PALAK KA PANCHNAMA",        keywords:["palak","panchnama"] },
];

const FACILITY_CITY_MAP = {
  "erbanglore":"BLR","erbangalore":"BLR","bangalore":"BLR","blr":"BLR",
  "erkolkata":"KOL","kolkata":"KOL","kol":"KOL",
  "erdelhi":"DEL","delhi":"DEL","del":"DEL",
};

const CITIES = {
  BLR: { label:"BANGALORE", transit:6,  color:"#FF2323", emoji:"🔴" },
  KOL: { label:"KOLKATA",   transit:8,  color:"#FF6B00", emoji:"🟠" },
  DEL: { label:"DELHI",     transit:7,  color:"#FFD600", emoji:"🟡" },
};

/* ── KILRR PALETTE ── */
const K = {
  bg:      "#1E1A19",
  s1:      "#272220",
  s2:      "#302B29",
  s3:      "#3A3330",
  bdr:     "#4A4340",
  red:     "#FF2323",
  redDim:  "rgba(255,35,35,0.10)",
  orange:  "#FF6B00",
  yellow:  "#FFD600",
  white:   "#FFFFFF",
  t1:      "#FFFFFF",
  t2:      "#AAAAAA",
  t3:      "#555555",
  green:   "#22C55E",
  greenDim:"rgba(34,197,94,0.10)",
  amber:   "#F59E0B",
  amberDim:"rgba(245,158,11,0.10)",
  danger:  "#FF2323",
  dangerDim:"rgba(255,35,35,0.10)",
};

const ceil50 = n => Math.ceil(n / 50) * 50;

function matchFlavour(val) {
  if (!val) return null;
  const lower = String(val).toLowerCase().trim();
  const exact = FLAVOUR_MAP.find(f => f.full.toLowerCase() === lower || f.short.toLowerCase() === lower);
  if (exact) return exact.short;
  let best = null, bestScore = 0;
  for (const f of FLAVOUR_MAP) {
    const score = f.keywords.filter(k => lower.includes(k)).length;
    if (score > bestScore) { bestScore = score; best = f.short; }
  }
  return bestScore > 0 ? best : null;
}

function parseDate(str) {
  if (!str) return null;
  const s = String(str).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(iso[0]);
  const dmy = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (dmy) return new Date(`${dmy[3]}-${dmy[2]}-${dmy[1]}`);
  return null;
}

async function parseFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const wb = XLSX.read(ev.target.result, { type:"array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json(ws, { defval:"" }));
      } catch(e) { reject(e); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

/* ── NUM INPUT ── */
function NumInput({ value, onChange }) {
  return (
    <input type="number" min={0} value={value}
      onChange={e => onChange(Math.max(0, parseInt(e.target.value)||0))}
      style={{
        width:"100%", padding:"8px 10px", borderRadius:4,
        border:`1px solid ${K.bdr}`, background:K.s3,
        color:K.white, fontFamily:"'Space Mono',monospace",
        fontSize:13, outline:"none", textAlign:"center",
        transition:"border-color .15s",
      }}
      onFocus={e => e.target.style.borderColor = K.red}
      onBlur={e => e.target.style.borderColor = K.bdr}
    />
  );
}

/* ── STATUS CHIP ── */
function StatusChip({ days }) {
  const color = days < 0 ? K.danger : days < 7 ? K.amber : K.green;
  const bg    = days < 0 ? K.dangerDim : days < 7 ? K.amberDim : K.greenDim;
  const label = days < 0 ? "OVERSTOCKED" : days < 7 ? "CRITICAL" : "OK";
  return (
    <span style={{ padding:"3px 9px", borderRadius:3, fontSize:9, fontWeight:700,
      letterSpacing:1.2, fontFamily:"'Space Mono',monospace",
      background:bg, color, border:`1px solid ${color}50` }}>
      {label}
    </span>
  );
}

/* ── COLUMN MAPPER MODAL ── */
function ColumnMapper({ title, headers, preview, fields, onConfirm, onClose }) {
  const [mapping, setMapping] = useState(() => {
    const init = {};
    fields.forEach(f => {
      init[f.key] = headers.find(h => f.detect.some(d => h.toLowerCase().includes(d))) || "";
    });
    return init;
  });

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.90)",
      display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, backdropFilter:"blur(6px)" }}>
      <div style={{ background:K.s1, border:`1px solid ${K.bdr}`,
        borderTop:`3px solid ${K.red}`, borderRadius:8,
        padding:32, width:560, maxWidth:"95vw", maxHeight:"90vh", overflowY:"auto" }}>

        <div style={{ fontFamily:"'Bebas Neue',cursive", fontSize:22, letterSpacing:2,
          color:K.white, marginBottom:4 }}>{title}</div>
        <div style={{ fontSize:11, color:K.t3, marginBottom:24, fontFamily:"'Space Mono',monospace" }}>
          MAP YOUR COLUMNS BELOW
        </div>

        {fields.map(f => (
          <div key={f.key} style={{ marginBottom:18 }}>
            <div style={{ fontSize:10, fontWeight:700, color:K.t2, letterSpacing:1.5,
              textTransform:"uppercase", fontFamily:"'Space Mono',monospace", marginBottom:6 }}>
              {f.label}
            </div>
            <select value={mapping[f.key]} onChange={e => setMapping(m=>({...m,[f.key]:e.target.value}))}
              style={{ background:K.s3, color:mapping[f.key]?K.red:K.t3,
                border:`1px solid ${mapping[f.key]?K.red:K.bdr}`,
                borderRadius:4, padding:"8px 12px", fontSize:12,
                fontFamily:"'Space Mono',monospace", outline:"none", width:"100%" }}>
              <option value="">— skip —</option>
              {headers.map(h=><option key={h} value={h}>{h}</option>)}
            </select>
          </div>
        ))}

        {/* Preview */}
        <div style={{ background:K.s2, borderRadius:6, padding:14,
          borderLeft:`3px solid ${K.red}`, maxHeight:160, overflowY:"auto", marginBottom:24 }}>
          <div style={{ fontSize:9, color:K.t3, letterSpacing:1.5,
            textTransform:"uppercase", fontFamily:"'Space Mono',monospace", marginBottom:10 }}>
            PREVIEW — FIRST 5 ROWS
          </div>
          {preview.slice(0,5).map((row,i) => {
            const skuVal = row[mapping["sku"]||""] || "";
            const matched = matchFlavour(skuVal);
            return (
              <div key={i} style={{ display:"flex", gap:12, fontSize:11, marginBottom:5, flexWrap:"wrap" }}>
                <span style={{ color:matched?K.green:K.red,
                  fontFamily:"'Space Mono',monospace", minWidth:110 }}>
                  {matched ? `✓ ${matched}` : `? ${String(skuVal).slice(0,20)}`}
                </span>
                {fields.filter(f=>f.key!=="sku").map(f => mapping[f.key] && (
                  <span key={f.key} style={{ color:K.t2, fontFamily:"'Space Mono',monospace" }}>
                    {f.shortLabel}: <span style={{color:K.yellow}}>{String(row[mapping[f.key]]).slice(0,15)}</span>
                  </span>
                ))}
              </div>
            );
          })}
        </div>

        <div style={{ display:"flex", gap:10 }}>
          <button onClick={() => onConfirm(mapping)}
            style={{ flex:1, padding:"13px", borderRadius:4, border:"none",
              background:K.red, color:K.white, fontWeight:700, fontSize:13,
              cursor:"pointer", fontFamily:"'Bebas Neue',cursive", letterSpacing:2, fontSize:16 }}>
            APPLY & FILL
          </button>
          <button onClick={onClose}
            style={{ padding:"13px 20px", borderRadius:4, border:`1px solid ${K.bdr}`,
              background:"transparent", color:K.t2, fontWeight:700, fontSize:13,
              cursor:"pointer", fontFamily:"'Space Mono',monospace" }}>
            CANCEL
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── DEMAND PREVIEW MODAL ── */
function DemandPreview({ results, dateRange, city, onConfirm, onClose }) {
  const cityConf = CITIES[city] || CITIES.BLR;
  const totalOrders = Object.values(results).reduce((s,r)=>s+r.total,0);

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.90)",
      display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, backdropFilter:"blur(6px)" }}>
      <div style={{ background:K.s1, border:`1px solid ${K.bdr}`,
        borderTop:`3px solid ${K.green}`, borderRadius:8,
        padding:32, width:600, maxWidth:"95vw", maxHeight:"90vh", overflowY:"auto" }}>

        <div style={{ fontFamily:"'Bebas Neue',cursive", fontSize:24, letterSpacing:2, marginBottom:4 }}>
          🔥 DAILY DEMAND CALCULATED
        </div>
        <div style={{ display:"flex", gap:16, marginBottom:20, flexWrap:"wrap" }}>
          {[
            { label:"CITY", val:cityConf.label, color:cityConf.color },
            { label:"DATE RANGE", val:dateRange, color:K.yellow },
            { label:"TOTAL ORDERS", val:totalOrders.toLocaleString(), color:K.green },
          ].map((s,i) => (
            <div key={i} style={{ background:K.s2, border:`1px solid ${K.bdr}`,
              borderRadius:4, padding:"8px 14px" }}>
              <div style={{ fontSize:9, color:K.t3, letterSpacing:1.5,
                fontFamily:"'Space Mono',monospace", marginBottom:3 }}>{s.label}</div>
              <div style={{ fontFamily:"'Space Mono',monospace", fontWeight:700,
                fontSize:13, color:s.color }}>{s.val}</div>
            </div>
          ))}
        </div>

        <div style={{ border:`1px solid ${K.bdr}`, borderRadius:6, overflow:"hidden", marginBottom:24 }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
            <thead>
              <tr style={{ background:K.s2, borderBottom:`1px solid ${K.bdr}` }}>
                {["FLAVOUR","FULL NAME","TOTAL SOLD","DAYS","DAILY DEMAND"].map(h=>(
                  <th key={h} style={{ padding:"10px 14px", textAlign:"left",
                    fontSize:9, fontWeight:700, color:K.t3, letterSpacing:1.5,
                    fontFamily:"'Space Mono',monospace" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FLAVOUR_MAP.map((f,i) => {
                const r = results[f.short];
                return (
                  <tr key={i} style={{ borderBottom:`1px solid ${K.bdr}`,
                    background:i%2===0?K.s1:K.s2 }}>
                    <td style={{ padding:"9px 14px", fontWeight:700,
                      color:K.red, fontFamily:"'Space Mono',monospace", fontSize:11 }}>{f.short}</td>
                    <td style={{ padding:"9px 14px", fontSize:10, color:K.t3,
                      fontFamily:"'Space Mono',monospace" }}>{f.full}</td>
                    <td style={{ padding:"9px 14px", fontFamily:"'Space Mono',monospace",
                      color:r?K.white:K.t3 }}>{r?r.total:"—"}</td>
                    <td style={{ padding:"9px 14px", fontFamily:"'Space Mono',monospace",
                      color:K.t2 }}>{r?r.days:"—"}</td>
                    <td style={{ padding:"9px 14px" }}>
                      {r ? <span style={{ fontFamily:"'Space Mono',monospace", fontWeight:700,
                        fontSize:16, color:K.green }}>{r.daily}</span>
                        : <span style={{color:K.t3}}>0</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ display:"flex", gap:10 }}>
          <button onClick={onConfirm}
            style={{ flex:1, padding:14, borderRadius:4, border:"none",
              background:K.green, color:"#000", fontWeight:700,
              cursor:"pointer", fontFamily:"'Bebas Neue',cursive",
              letterSpacing:2, fontSize:16 }}>
            ✓ FILL INTO CALCULATOR
          </button>
          <button onClick={onClose}
            style={{ padding:"14px 20px", borderRadius:4, border:`1px solid ${K.bdr}`,
              background:"transparent", color:K.t2, fontWeight:700,
              cursor:"pointer", fontFamily:"'Space Mono',monospace" }}>
            CANCEL
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   MAIN APP
══════════════════════════════════════════ */
export default function StockCalculator() {
  const [city,        setCity]        = useState("BLR");
  const [targetDays,  setTargetDays]  = useState(12);
  const [rows,        setRows]        = useState(() => FLAVOUR_MAP.map(f => ({ flavour:f.short, qty:0, demand:0 })));
  const [invMapper,   setInvMapper]   = useState(null);
  const [demandModal, setDemandModal] = useState(null);
  const [toast,       setToast]       = useState(null);
  const [fillLog,     setFillLog]     = useState({ inv:[], demand:[] });
  const invRef = useRef(), soRef = useRef();
  const cityConf = CITIES[city];

  const showToast = (msg, color=K.green) => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 3200);
  };

  const handleInv = useCallback(async e => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const data = await parseFile(file);
      if (!data.length) return showToast("FILE EMPTY", K.red);
      setInvMapper({ headers: Object.keys(data[0]), preview: data });
    } catch { showToast("COULD NOT READ FILE", K.red); }
    e.target.value = "";
  }, []);

  const applyInv = useCallback(mapping => {
    const data = invMapper.preview;
    const updates = {}, log = [];
    for (const row of data) {
      const short = matchFlavour(row[mapping.sku]);
      if (!short) continue;
      updates[short] = parseInt(row[mapping.qty]) || 0;
      log.push(short);
    }
    setRows(prev => prev.map(r => updates[r.flavour]!==undefined ? {...r, qty:updates[r.flavour]} : r));
    setFillLog(p => ({ ...p, inv: log }));
    setInvMapper(null);
    showToast(`QTY LOADED FOR ${log.length} FLAVOURS`, K.red);
  }, [invMapper]);

  const handleSO = useCallback(async e => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const data = await parseFile(file);
      if (!data.length) return showToast("FILE EMPTY", K.red);
      const headers = Object.keys(data[0]);

      const skuCol    = headers.find(h => /sku.?name|item.?type.?name/i.test(h)) || headers.find(h=>/sku/i.test(h)) || "";
      const dateCol   = headers.find(h => /order.?date/i.test(h)) || headers.find(h=>/date/i.test(h)) || "";
      const facCol    = headers.find(h => /facility/i.test(h)) || "";
      const statusCol = headers.find(h => /sale.?order.?item.?status|item.?status/i.test(h)) || "";

      const counts = {};
      let detectedCity = null;

      for (const row of data) {
        const status = String(row[statusCol]||"").toUpperCase();
        if (status === "CANCELLED") continue;
        if (!detectedCity && facCol) {
          const fac = String(row[facCol]||"").toLowerCase().replace(/[^a-z]/g,"");
          for (const [key, code] of Object.entries(FACILITY_CITY_MAP)) {
            if (fac.includes(key)) { detectedCity = code; break; }
          }
        }
        const short = matchFlavour(row[skuCol]);
        if (!short) continue;
        if (!counts[short]) counts[short] = { dates: new Set(), total: 0 };
        counts[short].total += 1;
        const d = parseDate(row[dateCol]);
        if (d) counts[short].dates.add(d.toISOString().slice(0,10));
      }

      const allDates = new Set();
      Object.values(counts).forEach(c => c.dates.forEach(d => allDates.add(d)));
      const numDays = allDates.size || 1;
      const minDate = [...allDates].sort()[0];
      const maxDate = [...allDates].sort().slice(-1)[0];

      const results = {};
      for (const [short, c] of Object.entries(counts)) {
        results[short] = { total:c.total, days:numDays, daily:Math.ceil(c.total/numDays) };
      }

      setDemandModal({ results, dateRange:`${minDate} → ${maxDate} (${numDays}d)`, city:detectedCity||city });
    } catch { showToast("COULD NOT READ FILE", K.red); }
    e.target.value = "";
  }, [city]);

  const applyDemand = useCallback(() => {
    const { results, city:dc } = demandModal;
    const log = [];
    setRows(prev => prev.map(r => {
      const res = results[r.flavour];
      if (!res) return r;
      log.push(r.flavour);
      return { ...r, demand: res.daily };
    }));
    setFillLog(p => ({ ...p, demand: log }));
    if (dc && dc !== city) setCity(dc);
    setDemandModal(null);
    showToast(`DEMAND LOADED FOR ${log.length} FLAVOURS`, K.green);
  }, [demandModal, city]);

  const calc = useMemo(() => rows.map(r => {
    const sat  = r.qty - r.demand * cityConf.transit;
    const lat  = r.demand > 0 ? sat / r.demand : 0;
    const need = targetDays * r.demand - sat;
    const send = r.demand === 0 ? 0 : Math.max(0, ceil50(need));
    const sas  = sat + send;
    const las  = r.demand > 0 ? sas / r.demand : 0;
    return { ...r, sat, lat, send, sas, las };
  }), [rows, cityConf, targetDays]);

  const totalSend = calc.reduce((s,r)=>s+r.send,0);
  const critical  = calc.filter(r=>r.demand>0&&r.lat<3).length;

  const updateRow = (idx, field, val) =>
    setRows(prev => prev.map((r,i) => i===idx ? {...r,[field]:val} : r));
  const reset = () => { setRows(FLAVOUR_MAP.map(f=>({flavour:f.short,qty:0,demand:0}))); setFillLog({inv:[],demand:[]}); };

  const exportCSV = () => {
    const hdr = ["Flavour","Full Name","Qty","Daily Demand",`After ${cityConf.transit}D`,`Life ${cityConf.transit}D`,"To Send","After Send","Est Life"];
    const body = calc.map(r => {
      const fm = FLAVOUR_MAP.find(f=>f.short===r.flavour);
      return [r.flavour,fm?.full,r.qty,r.demand,
        r.demand>0?r.sat.toFixed(0):"",r.demand>0?r.lat.toFixed(1)+"d":"",
        r.demand>0?r.send:"",r.demand>0?r.sas.toFixed(0):"",r.demand>0?r.las.toFixed(1)+"d":""];
    });
    const csv = [hdr,...body].map(r=>r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = `kilrr-stock-${city}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  const sc = d => d < 0 ? K.danger : d < 7 ? K.amber : K.green;
  const sb = d => d < 0 ? K.dangerDim : d < 7 ? K.amberDim : K.greenDim;

  return (
    <div style={{ minHeight:"100vh", background:K.bg, color:K.white,
      fontFamily:"'Space Mono',monospace" }}>
      <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet"/>

      {/* TOAST */}
      {toast && (
        <div style={{ position:"fixed", top:20, right:24, zIndex:300,
          padding:"12px 22px", borderRadius:4, background:toast.color,
          color: toast.color === K.green ? "#000" : K.white,
          fontWeight:700, fontSize:12, letterSpacing:1.5,
          fontFamily:"'Bebas Neue',cursive", fontSize:16,
          boxShadow:"0 4px 30px rgba(0,0,0,0.6)", animation:"fadeIn .2s ease" }}>
          {toast.msg}
        </div>
      )}

      {invMapper && (
        <ColumnMapper title="📦 MAP INVENTORY COLUMNS"
          headers={invMapper.headers} preview={invMapper.preview}
          fields={[
            { key:"sku", label:"SKU / PRODUCT NAME", shortLabel:"SKU", hint:"Column with flavour names", detect:["sku","item","product","name"] },
            { key:"qty", label:"QTY IN-HAND / AVAILABLE STOCK", shortLabel:"Qty", hint:"Current inventory count", detect:["qty","quantity","available","inventory","stock"] },
          ]}
          onConfirm={applyInv} onClose={()=>setInvMapper(null)} />
      )}

      {demandModal && (
        <DemandPreview results={demandModal.results} dateRange={demandModal.dateRange}
          city={demandModal.city} onConfirm={applyDemand} onClose={()=>setDemandModal(null)} />
      )}

      {/* ── HEADER ── */}
      <div style={{ background:K.s1, borderBottom:`1px solid ${K.bdr}`,
        padding:"0 28px", position:"sticky", top:0, zIndex:100 }}>
        {/* Red top stripe */}
        <div style={{ height:3, background:`linear-gradient(90deg,${K.red},${K.orange},${K.yellow})`,
          margin:"0 -28px", marginBottom:0 }} />
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 0" }}>
          <div style={{ display:"flex", alignItems:"center", gap:16 }}>
            {/* KILRR wordmark style */}
            <div style={{ fontFamily:"'Bebas Neue',cursive", fontSize:26, letterSpacing:4,
              background:`linear-gradient(135deg,${K.red},${K.orange})`,
              WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>
              KILRR
            </div>
            <div style={{ width:1, height:28, background:K.bdr }} />
            <div>
              <div style={{ fontFamily:"'Bebas Neue',cursive", fontSize:18, letterSpacing:3, color:K.white }}>
                STOCK SENDING CALCULATOR
              </div>
              <div style={{ fontSize:9, color:K.t3, letterSpacing:1.5, marginTop:1 }}>
                {cityConf.label} · {cityConf.transit}D TRANSIT · TARGET {targetDays}D
              </div>
            </div>
          </div>

          <div style={{ display:"flex", gap:8 }}>
            <input ref={invRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleInv} style={{display:"none"}} />
            <input ref={soRef}  type="file" accept=".xlsx,.xls,.csv" onChange={handleSO}  style={{display:"none"}} />

            <button onClick={()=>invRef.current.click()} style={{
              padding:"9px 18px", borderRadius:3, cursor:"pointer",
              border:`1px solid ${fillLog.inv.length?K.red:K.bdr}`,
              background:fillLog.inv.length?K.redDim:"transparent",
              color:fillLog.inv.length?K.red:K.t2,
              fontFamily:"'Bebas Neue',cursive", letterSpacing:1.5, fontSize:14, transition:"all .15s" }}>
              {fillLog.inv.length ? `✓ INVENTORY (${fillLog.inv.length})` : "⬆ INVENTORY REPORT"}
            </button>
            <button onClick={()=>soRef.current.click()} style={{
              padding:"9px 18px", borderRadius:3, cursor:"pointer",
              border:`1px solid ${fillLog.demand.length?K.green:K.bdr}`,
              background:fillLog.demand.length?K.greenDim:"transparent",
              color:fillLog.demand.length?K.green:K.t2,
              fontFamily:"'Bebas Neue',cursive", letterSpacing:1.5, fontSize:14, transition:"all .15s" }}>
              {fillLog.demand.length ? `✓ DEMAND (${fillLog.demand.length})` : "⬆ SALE ORDERS REPORT"}
            </button>
            <button onClick={exportCSV} style={{ padding:"9px 14px", borderRadius:3,
              border:`1px solid ${K.bdr}`, background:"transparent", color:K.t2,
              fontFamily:"'Bebas Neue',cursive", letterSpacing:1.5, fontSize:14, cursor:"pointer" }}>
              ↓ CSV
            </button>
            <button onClick={reset} style={{ padding:"9px 14px", borderRadius:3,
              border:`1px solid ${K.bdr}`, background:"transparent", color:K.t2,
              fontFamily:"'Bebas Neue',cursive", letterSpacing:1.5, fontSize:14, cursor:"pointer" }}>
              RESET
            </button>
          </div>
        </div>
      </div>

      <div style={{ padding:"24px 28px", maxWidth:1440, margin:"0 auto" }}>

        {/* STEP CARDS */}
        {(!fillLog.inv.length || !fillLog.demand.length) && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:24 }}>
            {[
              { step:"01", label:"LOAD INVENTORY", sub:"Upload Unicommerce inventory snapshot", done:fillLog.inv.length>0, color:K.red, count:fillLog.inv.length, onClick:()=>invRef.current.click() },
              { step:"02", label:"LOAD SALE ORDERS", sub:"Upload Unicommerce sale orders export", done:fillLog.demand.length>0, color:K.green, count:fillLog.demand.length, onClick:()=>soRef.current.click() },
            ].map(s => (
              <div key={s.step} onClick={s.done?undefined:s.onClick}
                style={{ background:K.s1, borderRadius:6, padding:22, cursor:s.done?"default":"pointer",
                  border:`1px solid ${s.done?s.color+"60":K.bdr}`,
                  borderLeft:`4px solid ${s.done?s.color:K.bdr}`,
                  display:"flex", alignItems:"center", gap:18, transition:"all .2s",
                  ...(s.done?{}:{}) }}>
                <div style={{ fontFamily:"'Bebas Neue',cursive", fontSize:48, lineHeight:1,
                  color:s.done?s.color:K.s3, transition:"color .2s" }}>{s.step}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontFamily:"'Bebas Neue',cursive", fontSize:18, letterSpacing:2,
                    color:s.done?s.color:K.white }}>{s.label}</div>
                  <div style={{ fontSize:10, color:K.t3, marginTop:3, letterSpacing:.5 }}>
                    {s.done ? `${s.count} FLAVOURS LOADED` : s.sub}
                  </div>
                </div>
                {!s.done && (
                  <div style={{ fontFamily:"'Bebas Neue',cursive", fontSize:24,
                    color:K.t3, letterSpacing:2 }}>UPLOAD →</div>
                )}
                {s.done && <div style={{ fontSize:28 }}>✅</div>}
              </div>
            ))}
          </div>
        )}

        {/* KPI + CONTROLS */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:16, marginBottom:24 }}>

          {/* City selector */}
          <div style={{ background:K.s1, border:`1px solid ${K.bdr}`, borderRadius:6, padding:20 }}>
            <div style={{ fontSize:9, color:K.t3, letterSpacing:2, textTransform:"uppercase", marginBottom:12 }}>SELECT CITY</div>
            <div style={{ display:"flex", gap:8 }}>
              {Object.entries(CITIES).map(([key,cfg]) => (
                <button key={key} onClick={()=>setCity(key)} style={{
                  flex:1, padding:"10px 6px", borderRadius:3, cursor:"pointer",
                  border:`2px solid ${city===key?cfg.color:K.bdr}`,
                  background:city===key?`${cfg.color}15`:"transparent",
                  color:city===key?cfg.color:K.t3,
                  fontFamily:"'Bebas Neue',cursive", letterSpacing:2, fontSize:15,
                  transition:"all .2s", textAlign:"center" }}>
                  {key}
                  <div style={{ fontSize:9, letterSpacing:1, opacity:.7, marginTop:2,
                    fontFamily:"'Space Mono',monospace" }}>{cfg.transit}D</div>
                </button>
              ))}
            </div>
          </div>

          {/* Target days */}
          <div style={{ background:K.s1, border:`1px solid ${K.bdr}`, borderRadius:6, padding:20 }}>
            <div style={{ fontSize:9, color:K.t3, letterSpacing:2, textTransform:"uppercase", marginBottom:12 }}>TARGET STOCK DAYS</div>
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <input type="range" min={7} max={21} step={1} value={targetDays}
                onChange={e=>setTargetDays(+e.target.value)}
                style={{ flex:1, accentColor:K.red }} />
              <span style={{ fontFamily:"'Bebas Neue',cursive", fontSize:36,
                color:K.red, minWidth:60, lineHeight:1 }}>{targetDays}<span style={{fontSize:18}}>D</span></span>
            </div>
          </div>

          {/* Total KPI */}
          <div style={{ background:K.s1, border:`1px solid ${K.red}40`,
            borderRadius:6, padding:20, borderLeft:`4px solid ${K.red}`,
            display:"flex", flexDirection:"column", justifyContent:"center" }}>
            <div style={{ fontSize:9, color:K.t3, letterSpacing:2, textTransform:"uppercase", marginBottom:6 }}>TOTAL TO SEND</div>
            <div style={{ fontFamily:"'Bebas Neue',cursive", fontSize:44, color:K.red, lineHeight:1 }}>
              {totalSend.toLocaleString()}
              <span style={{ fontSize:18, color:K.t2, marginLeft:6 }}>PKTS</span>
            </div>
            {critical > 0 && (
              <div style={{ fontSize:10, color:K.red, marginTop:6, letterSpacing:1 }}>
                ⚠ {critical} CRITICAL FLAVOUR{critical>1?"S":""}
              </div>
            )}
          </div>
        </div>

        {/* ── TABLE ── */}
        <div style={{ border:`1px solid ${K.bdr}`, borderRadius:6, overflow:"hidden" }}>
          {/* Table header bar */}
          <div style={{ background:K.red, padding:"10px 20px",
            display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span style={{ fontFamily:"'Bebas Neue',cursive", fontSize:16, letterSpacing:3 }}>
              DISPATCH PLAN — {cityConf.label} — {new Date().toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}).toUpperCase()}
            </span>
            <div style={{ display:"flex", gap:12, fontSize:9, color:"rgba(255,255,255,0.6)", letterSpacing:1 }}>
              <span>● INV FILLED</span>
              <span>● DEMAND FILLED</span>
            </div>
          </div>

          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead>
                <tr style={{ background:K.s2, borderBottom:`1px solid ${K.bdr}` }}>
                  {[
                    { h:"", w:20 },
                    { h:"FLAVOUR" }, { h:"FULL NAME" },
                    { h:"QTY IN-HAND ⬆", c:K.red },
                    { h:"DAILY DEMAND ⬆", c:K.green },
                    { h:`AFTER ${cityConf.transit}D TRANSIT` },
                    { h:`LIFE AFTER ${cityConf.transit}D` },
                    { h:"TO SEND (PKTS)", c:K.yellow },
                    { h:"AFTER SEND" },
                    { h:"EST LIFE" },
                    { h:"STATUS" },
                  ].map((col,i) => (
                    <th key={i} style={{ padding:"11px 12px", textAlign:"left",
                      fontSize:9, fontWeight:700, color:col.c||K.t3,
                      letterSpacing:1.2, fontFamily:"'Space Mono',monospace",
                      whiteSpace:"nowrap", ...(col.w?{width:col.w}:{}) }}>
                      {col.h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {calc.map((row,idx) => {
                  const fm   = FLAVOUR_MAP.find(f=>f.short===row.flavour);
                  const invF = fillLog.inv.includes(row.flavour);
                  const dmdF = fillLog.demand.includes(row.flavour);
                  const urg  = row.demand>0 && row.lat<3;
                  const even = idx%2===0;
                  return (
                    <tr key={idx}
                      style={{ borderBottom:`1px solid ${K.bdr}`,
                        background:urg?"rgba(255,35,35,0.07)":even?K.s1:K.s2,
                        transition:"background .1s" }}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(255,35,35,0.05)"}
                      onMouseLeave={e=>e.currentTarget.style.background=urg?"rgba(255,35,35,0.07)":even?K.s1:K.s2}>

                      {/* dot indicators */}
                      <td style={{ padding:"8px 6px 8px 12px" }}>
                        <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                          {invF && <div style={{ width:5, height:5, borderRadius:"50%", background:K.red }} />}
                          {dmdF && <div style={{ width:5, height:5, borderRadius:"50%", background:K.green }} />}
                        </div>
                      </td>

                      <td style={{ padding:"11px 12px" }}>
                        <span style={{ fontFamily:"'Bebas Neue',cursive", fontSize:16,
                          letterSpacing:1, color:cityConf.color }}>{row.flavour}</span>
                      </td>
                      <td style={{ padding:"8px 12px" }}>
                        <span style={{ fontSize:10, color:K.t3 }}>{fm?.full}</span>
                      </td>
                      <td style={{ padding:"6px 10px", minWidth:95 }}>
                        <NumInput value={row.qty} onChange={v=>updateRow(idx,"qty",v)} />
                      </td>
                      <td style={{ padding:"6px 10px", minWidth:95 }}>
                        <NumInput value={row.demand} onChange={v=>updateRow(idx,"demand",v)} />
                      </td>
                      <td style={{ padding:"11px 12px" }}>
                        <span style={{ fontFamily:"'Space Mono',monospace", fontWeight:700,
                          color:row.demand>0?(row.sat<0?K.danger:K.white):K.t3 }}>
                          {row.demand>0 ? row.sat.toFixed(0) : "—"}
                        </span>
                      </td>
                      <td style={{ padding:"11px 12px" }}>
                        <span style={{ fontFamily:"'Space Mono',monospace", fontWeight:700,
                          color:row.demand>0?sc(row.lat):K.t3 }}>
                          {row.demand>0 ? `${row.lat.toFixed(1)}D` : "—"}
                        </span>
                      </td>
                      <td style={{ padding:"11px 12px" }}>
                        {row.demand>0 ? (
                          row.send > 0 ? (
                            <span style={{ fontFamily:"'Bebas Neue',cursive",
                              fontSize:20, color:K.yellow,
                              background:"rgba(255,214,0,0.10)",
                              padding:"3px 14px", borderRadius:3, display:"inline-block",
                              border:`1px solid rgba(255,214,0,0.3)` }}>
                              {row.send.toLocaleString()}
                            </span>
                          ) : (
                            <span style={{ fontFamily:"'Space Mono',monospace",
                              fontSize:12, color:K.t3 }}>0</span>
                          )
                        ) : <span style={{color:K.t3}}>—</span>}
                      </td>
                      <td style={{ padding:"11px 12px" }}>
                        <span style={{ fontFamily:"'Space Mono',monospace", color:K.t2 }}>
                          {row.demand>0 ? row.sas.toFixed(0) : "—"}
                        </span>
                      </td>
                      <td style={{ padding:"11px 12px" }}>
                        <span style={{ fontFamily:"'Space Mono',monospace", fontWeight:700,
                          color:row.demand>0?sc(row.las):K.t3 }}>
                          {row.demand>0 ? `${row.las.toFixed(1)}D` : "—"}
                        </span>
                      </td>
                      <td style={{ padding:"11px 12px" }}>
                        {row.demand>0 ? <StatusChip days={row.las} /> : <span style={{color:K.t3,fontSize:10}}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background:K.s2, borderTop:`2px solid ${K.red}` }}>
                  <td colSpan={7} style={{ padding:"14px 12px" }}>
                    <span style={{ fontFamily:"'Bebas Neue',cursive", fontSize:12,
                      letterSpacing:2, color:K.t3 }}>TOTAL DISPATCH</span>
                  </td>
                  <td style={{ padding:"14px 12px" }}>
                    <span style={{ fontFamily:"'Bebas Neue',cursive", fontSize:24,
                      color:K.yellow }}>{totalSend.toLocaleString()} PKTS</span>
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* FORMULA BAR */}
        <div style={{ marginTop:16, background:K.s1, border:`1px solid ${K.bdr}`,
          borderRadius:6, padding:"12px 20px",
          display:"flex", gap:24, flexWrap:"wrap", alignItems:"center" }}>
          <span style={{ fontSize:9, color:K.t3, letterSpacing:2, fontFamily:"'Bebas Neue',cursive",
            fontSize:12 }}>FORMULAS:</span>
          {[
            `After transit = Qty − (Demand × ${cityConf.transit})`,
            `To Send = ceil(max(0, ${targetDays}×D−Stock) ÷ 50) × 50`,
            `Daily Demand = Total sold ÷ Days in report`,
          ].map((f,i) => (
            <span key={i} style={{ fontSize:10, color:K.t2, fontFamily:"'Space Mono',monospace" }}>{f}</span>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:translateY(0)} }
        input[type=number]::-webkit-inner-spin-button { -webkit-appearance:none }
        input[type=number] { -moz-appearance:textfield }
        input[type=range] { height:4px }
        select option { background:#1A1A1A; color:#fff; }
      `}</style>
    </div>
  );
}
