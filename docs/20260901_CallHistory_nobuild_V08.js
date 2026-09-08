/*
 * Call-History Widget  |  Version V08 (no-build)  |  20260901  (Dark-Mode-Fix: nur bei darkmode=true)
 * Eigenstaendige Datei OHNE SDK und OHNE Build-Schritt.
 *  - Token kommt aus dem Layout ($STORE.auth.accessToken -> Property accessToken)
 *  - Historie:  GET  /v1/history/agentHistory          (letzte 24h, Agent-Token)
 *  - Kundenname (Telefonie): GET /admin/v1/api/person/workspace-id/{ws}/aliases/{nr}
 *  - Rueckruf:  POST /v1/tasks                           (Outdial, ohne SDK)
 * Direkt hosten und editieren - kein npm, kein webpack.
 *
 * Optionale Attribute im Layout: darkmode, data-center, outdial-ep, outbound-type,
 *   outdial-ani, cjds-workspace-id, agent-id, organization-id
 * Pflicht-Property im Layout:    accessToken: "$STORE.auth.accessToken"
 */
(function () {
  "use strict";
  var TAG = "agent-history-list";
  if (customElements.get(TAG)) { return; }

  // ---- Defaults (per Attribut ueberschreibbar) ----
  var DEF_DC = "eu1";
  var DEF_WS = "682f3b007542bf078915f230";                 // CJDS Journey-Workspace
  var DEF_OUTDIAL_EP = "ab483d0e-292b-461a-8904-4b6cd10403b1";
  var DEF_OUTBOUND_TYPE = "OUTDIAL";
  var DAY_MS = 24 * 60 * 60 * 1000;

  // ---- Helfer ----
  function pad2(n){ return n < 10 ? "0"+n : ""+n; }
  function esc(s){
    if (s === null || s === undefined) { return ""; }
    return String(s).replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }
  function parseWhen(v){
    if (v === null || v === undefined || v === "") { return null; }
    if (v instanceof Date) { return isNaN(v.getTime()) ? null : v; }
    if (typeof v === "number") { var d = new Date(v < 1e12 ? v*1000 : v); return isNaN(d.getTime()) ? null : d; }
    var s = String(v).trim();
    if (/^\d{10}$/.test(s)) { var d10 = new Date(parseInt(s,10)*1000); return isNaN(d10) ? null : d10; }
    if (/^\d{13}$/.test(s)) { var d13 = new Date(parseInt(s,10)); return isNaN(d13) ? null : d13; }
    var dd = new Date(s); return isNaN(dd.getTime()) ? null : dd;
  }
  function fmtDate(v){ var d = parseWhen(v); return d ? pad2(d.getDate())+"."+pad2(d.getMonth()+1)+"."+d.getFullYear() : "–"; }
  function fmtTime(v){ var d = parseWhen(v); return d ? pad2(d.getHours())+":"+pad2(d.getMinutes()) : "–"; }
  function fmtDur(ms){ if (ms==null || isNaN(ms)) { return "–"; } var s = Math.max(0, Math.round(Number(ms)/1000)); return Math.floor(s/60)+":"+pad2(s%60); }
  function b64urlDecode(seg){
    seg = String(seg).replace(/-/g,"+").replace(/_/g,"/"); seg += "=".repeat((4 - seg.length % 4) % 4);
    try { return decodeURIComponent(escape(atob(seg))); } catch(e){ try { return atob(seg); } catch(e2){ return ""; } }
  }
  function decodeToken(token){
    try { var p = JSON.parse(b64urlDecode(String(token).split(".")[1])); return { agentId: p.cis_uuid || p.sub || "", orgId: p.org_id || "" }; }
    catch(e){ return { agentId:"", orgId:"" }; }
  }

  var COLS = ["Richtung","Datum","Uhrzeit","Dauer (m:ss)","Kunde","Entry Point","ANI"];

  var STYLE =
    ":host{display:block;font-family:Arial,sans-serif;color:#333}" +
    ":host([darkmode='true']),:host([darkmode='true']){color:#e8e8e8}" +
    ".container{margin:.5rem auto;padding:10px;background:#fff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1)}" +
    ":host([darkmode='true']) .container{background:#1f1f1f}" +
    "h1{font-size:1rem;margin:0 0 .4rem 0}" +
    ".toolbar{display:flex;gap:.5rem;align-items:center;justify-content:space-between;margin-bottom:.5rem}" +
    ".left{display:flex;gap:.4rem;align-items:center}.right{font-size:.75rem;color:#888}" +
    ".btn{padding:.3rem .7rem;font-size:.8rem;border:none;background:#0072C3;color:#fff;cursor:pointer;border-radius:4px}" +
    ".btn.secondary{background:#00a884}.btn.off{background:#6c757d}" +
    ".message{text-align:center;margin:.3rem 0;color:#888;font-size:.78rem;min-height:1em}" +
    "table{width:100%;border-collapse:collapse;margin-top:.3rem;font-size:.78rem}" +
    "th,td{padding:.25rem .45rem;text-align:left;border-bottom:1px solid #eee;white-space:nowrap}" +
    ":host([darkmode='true']) th,:host([darkmode='true']) td{border-bottom-color:#333}" +
    "thead{background:#f2f2f2}:host([darkmode='true']) thead{background:#2a2a2a}" +
    "thead th{font-size:.72rem;text-transform:uppercase;letter-spacing:.02em;color:#666}" +
    "tbody tr:nth-child(even){background:#fafafa}:host([darkmode='true']) tbody tr:nth-child(even){background:#262626}" +
    "tbody tr:hover{background:#e6f7ff}:host([darkmode='true']) tbody tr:hover{background:#333}" +
    ".badge{display:inline-block;padding:.05rem .4rem;border-radius:999px;font-weight:600;font-size:.72rem}" +
    ".in{background:#e8fff6;color:#067647}.out{background:#e8f0ff;color:#1e40af}" +
    ".muted{color:#999}.num{margin-right:.3rem}" +
    ".act{border:none;background:transparent;cursor:pointer;font-size:.85rem;padding:0 .1rem;line-height:1;vertical-align:middle}" +
    ".act:hover{opacity:.6}";

  var W = function(){ return Reflect.construct(HTMLElement, [], W); };
  W.prototype = Object.create(HTMLElement.prototype);
  W.prototype.constructor = W;

  ["accessToken","bearerToken","agentId","organizationId","datacenter","outdialEp","outboundType","outdialAni","cjdsWorkspaceId","pageSize"]
    .forEach(function(p){
      Object.defineProperty(W.prototype, p, { get:function(){ return this["_"+p]; }, set:function(v){ this["_"+p]=v; }, configurable:true });
    });

  W.prototype.connectedCallback = function(){
    if (!this.shadowRoot) { this.attachShadow({mode:"open"}); }
    this._auto = true; this._timer = null; this._nameCache = new Map();
    this._render();
    var self = this;
    this.shadowRoot.getElementById("refresh").addEventListener("click", function(){ self.load(); });
    this.shadowRoot.getElementById("auto").addEventListener("click", function(){ self._toggleAuto(); });
    this.shadowRoot.getElementById("rows").addEventListener("click", function(e){ self._onAction(e); });
    this.load();
    this._timer = setInterval(function(){ if (self._auto) { self.load(); } }, 15000);
  };
  W.prototype.disconnectedCallback = function(){ if (this._timer) { clearInterval(this._timer); this._timer = null; } };

  // ---- Config-Zugriff (Attribut/Property, zur Laufzeit) ----
  W.prototype._tok = function(){ return this.accessToken || this.bearerToken || this.getAttribute("access-token") || ""; };
  W.prototype._dc  = function(){ return (this.datacenter || this.getAttribute("data-center") || DEF_DC).toString().trim().toLowerCase(); };
  W.prototype._ws  = function(){ return this.cjdsWorkspaceId || this.getAttribute("cjds-workspace-id") || DEF_WS; };
  W.prototype._ep  = function(){ return this.outdialEp || this.getAttribute("outdial-ep") || DEF_OUTDIAL_EP; };
  W.prototype._obt = function(){ return this.outboundType || this.getAttribute("outbound-type") || DEF_OUTBOUND_TYPE; };
  W.prototype._ani = function(){ return this.outdialAni || this.getAttribute("outdial-ani") || ""; };
  W.prototype._size= function(){ var v = parseInt(this.pageSize || this.getAttribute("page-size"),10); return isNaN(v)||v<=0 ? 1000 : v; };
  W.prototype._api = function(){ return "https://api.wxcc-" + this._dc() + ".cisco.com"; };

  W.prototype._render = function(){
    this.shadowRoot.innerHTML =
      "<style>"+STYLE+"</style>" +
      "<div class='container'><h1>Agent-History – Anrufliste</h1>" +
      "<div class='toolbar'><div class='left'>" +
      "<button class='btn' id='refresh'>Aktualisieren</button>" +
      "<button class='btn secondary' id='auto'>Auto: an</button></div>" +
      "<div class='right' id='meta'>Intervall: 15s · Letzte Aktualisierung: –</div></div>" +
      "<div class='message' id='msg'></div>" +
      "<table><thead><tr>"+COLS.map(function(c){return "<th>"+esc(c)+"</th>";}).join("")+"</tr></thead>" +
      "<tbody id='rows'></tbody></table></div>";
  };
  W.prototype._toggleAuto = function(){
    var b = this.shadowRoot.getElementById("auto");
    this._auto = !this._auto;
    b.textContent = this._auto ? "Auto: an" : "Auto: aus";
    b.classList.toggle("off", !this._auto);
    b.classList.toggle("secondary", this._auto);
  };
  W.prototype._msg = function(t){ var m = this.shadowRoot.getElementById("msg"); if (m) { m.textContent = t || ""; } };
  W.prototype._stamp = function(){ var d = new Date(); this.shadowRoot.getElementById("meta").textContent = "Intervall: 15s · Letzte Aktualisierung: "+pad2(d.getHours())+":"+pad2(d.getMinutes())+":"+pad2(d.getSeconds()); };

  // ---- Historie laden (letzte 24h) ----
  W.prototype.load = function(){
    var self = this;
    var token = this._tok();
    if (!token) { this._msg("Kein Token (Property accessToken = $STORE.auth.accessToken im Layout setzen)."); return; }
    var agentId = this.getAttribute("agent-id") || this.agentId || decodeToken(token).agentId;
    var orgId = this.getAttribute("organization-id") || this.organizationId || decodeToken(token).orgId;
    if (!agentId) { this._msg("Keine Agent-ID aus dem Token ermittelbar."); return; }

    var to = Date.now(), from = to - DAY_MS;
    var url = this._api() + "/v1/history/agentHistory?agentId=" + encodeURIComponent(agentId) +
      "&page=0&pageSize=" + this._size() + "&from=" + from + "&to=" + to;

    fetch(url, { headers: { "Accept":"application/json", "X-Organization-Id":orgId, "Authorization":"Bearer "+token } })
      .then(function(r){ return r.text().then(function(t){ if (!r.ok) { throw new Error("HTTP "+r.status+" – "+t); } return t ? JSON.parse(t) : {}; }); })
      .then(function(data){ self._msg(""); self._renderRows(self._pick(data)); self._stamp(); self._enrich(token); })
      .catch(function(e){ self._msg("Fehler: "+(e && e.message ? e.message : String(e))); self._stamp(); });
  };

  W.prototype._pick = function(d){
    if (Array.isArray(d)) { return d; }
    if (d && Array.isArray(d.contacts)) { return d.contacts; }
    if (d && Array.isArray(d.data)) { return d.data; }
    if (d && Array.isArray(d.records)) { return d.records; }
    var seen = [], q = [d];
    while (q.length){ var o = q.shift(); if (o && typeof o === "object" && seen.indexOf(o) === -1){ seen.push(o); for (var k in o){ if (Array.isArray(o[k])) { return o[k]; } if (o[k] && typeof o[k] === "object") { q.push(o[k]); } } } }
    return [];
  };

  W.prototype._norm = function(r){
    var dir = String(r.callDirection || r.direction || "").toUpperCase().indexOf("OUT") !== -1 ? "OUT" : "IN";
    var talk = r.talkDuration != null ? r.talkDuration : (r.talkTimeMs != null ? r.talkTimeMs : 0);
    var custName = r.customerName || (r.customer && (r.customer.name || r.customer.displayName)) || "";
    var ep = r.entrypointName || r.entryPoint || "";
    var ch = r.channelType || "";
    var num = (dir === "IN") ? (r.ani || r.callerId || r.fromAddress || "") : (r.dnis || r.destination || "");
    var when = r.cstts || r.startTimestamp || r.createdTime || r.cetts || null;
    return { dir:dir, talk:talk, custName:custName, ep:ep, ch:ch, num:num, when:when };
  };

  W.prototype._renderRows = function(records){
    var tbody = this.shadowRoot.getElementById("rows");
    var rows = (records || []).map(this._norm).sort(function(a,b){ var da=parseWhen(a.when),db=parseWhen(b.when); return (db?db.getTime():0)-(da?da.getTime():0); });
    if (!rows.length){ tbody.innerHTML = "<tr><td colspan='7' class='muted' style='text-align:center;padding:1rem'>Keine Eintraege (letzte 24h).</td></tr>"; return; }
    var self = this;
    tbody.innerHTML = rows.map(function(r){
      var badge = r.dir === "OUT" ? "<span class='badge out'>Ausgehend</span>" : "<span class='badge in'>Eingehend</span>";
      var kunde = r.custName ? esc(r.custName) : "<span class='muted'>–</span>";
      var ani = r.num
        ? "<span class='num'>"+esc(r.num)+"</span><button class='act call' data-num='"+esc(r.num)+"' title='Rückruf an Kunde'>📞</button><button class='act copy' data-num='"+esc(r.num)+"' title='Nummer kopieren'>📋</button>"
        : "<span class='muted'>–</span>";
      return "<tr>" +
        "<td>"+badge+"</td>" +
        "<td>"+esc(fmtDate(r.when))+"</td>" +
        "<td>"+esc(fmtTime(r.when))+"</td>" +
        "<td>"+esc(fmtDur(r.talk))+"</td>" +
        "<td class='kunde' data-num='"+esc(r.num||"")+"' data-ch='"+esc(r.ch||"")+"'>"+kunde+"</td>" +
        "<td>"+(r.ep?esc(r.ep):"<span class='muted'>–</span>")+"</td>" +
        "<td>"+ani+"</td>" +
        "</tr>";
    }).join("");
  };

  // ---- Kundennamen (Telefonie) via CJDS nachfuellen ----
  W.prototype._enrich = function(token){
    var self = this;
    var cells = Array.prototype.slice.call(this.shadowRoot.querySelectorAll("td.kunde"))
      .filter(function(td){ return (td.getAttribute("data-ch")||"").toLowerCase()==="telephony" && (td.getAttribute("data-num")||"").trim() !== "" && !td.textContent.trim().replace("–",""); });
    if (!cells.length){ return; }
    var nums = cells.map(function(td){ return td.getAttribute("data-num").trim(); }).filter(function(v,i,a){ return a.indexOf(v)===i; });
    Promise.all(nums.map(function(num){
      if (self._nameCache.has(num)) { return Promise.resolve(); }
      return self._lookup(num, token).then(function(name){ self._nameCache.set(num, name); });
    })).then(function(){
      cells.forEach(function(td){ var n = self._nameCache.get(td.getAttribute("data-num").trim()); if (n) { td.textContent = n; } });
    });
  };
  W.prototype._lookup = function(number, token){
    var url = this._api() + "/admin/v1/api/person/workspace-id/" + this._ws() + "/aliases/" + encodeURIComponent(number);
    return fetch(url, { headers: { "Accept":"application/json", "Authorization":"Bearer "+token } })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(d){ var p = d && Array.isArray(d.data) && d.data[0]; return p ? [p.firstName,p.lastName].filter(Boolean).join(" ").trim() : ""; })
      .catch(function(){ return ""; });
  };

  // ---- Aktionen: Rueckruf (POST /v1/tasks) + Kopieren ----
  W.prototype._onAction = function(e){
    var btn = e.target.closest ? e.target.closest("button.act") : null;
    if (!btn) { return; }
    var num = btn.getAttribute("data-num") || "";
    if (!num) { return; }
    if (btn.classList.contains("call")) { this._callback(num); }
    else if (btn.classList.contains("copy")) { this._copy(num); }
  };
  W.prototype._callback = function(number){
    var self = this;
    var token = this._tok();
    if (!token) { this._msg("Kein Token fuer Outdial."); return; }
    var body = { entryPointId: this._ep(), destination: number, direction: "OUTBOUND", attributes: {}, mediaType: "telephony", outboundType: this._obt() };
    if (this._ani()) { body.origin = this._ani(); }
    this._msg("Rueckruf wird gestartet: " + number + " …");
    fetch(this._api() + "/v1/tasks", { method:"POST", headers: { "Content-Type":"application/json", "Authorization":"Bearer "+token }, body: JSON.stringify(body) })
      .then(function(r){ return r.text().then(function(t){ if (!r.ok){ var m=t; try{ m = JSON.parse(t).errorMessage || t; }catch(_){}; throw new Error(m); } return t; }); })
      .then(function(){ self._msg("Rueckruf ausgeloest: " + number); setTimeout(function(){ self._msg(""); }, 2500); })
      .catch(function(e){ self._msg("Outdial-Fehler: " + (e && e.message ? e.message : String(e))); });
  };
  W.prototype._copy = function(number){
    var self = this;
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(number).then(function(){ self._msg("Kopiert: "+number); setTimeout(function(){ self._msg(""); }, 1500); })
        .catch(function(){ self._msg("Kopieren nicht moeglich (Browser-Berechtigung)."); });
    } else { self._msg("Kopieren nicht unterstuetzt."); }
  };

  customElements.define(TAG, W);
})();
