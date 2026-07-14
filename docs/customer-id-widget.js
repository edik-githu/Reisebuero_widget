/*
 * customer-id-widget.js
 * -------------------------------------------------------------------------
 * Zusatz-Widget fuer den Webex Contact Center Agent Desktop.
 * Ablauf beim eingehenden Anruf:
 *   1. ANI (Rufnummer des Anrufers) aus interactionData lesen
 *   2. Person per Alias (ANI) holen  -> GET .../aliases/{ani}
 *   3. customerId + Name dem Agenten anzeigen
 *   4. Aendert der Agent die customerId: alten Wert entfernen, neuen hinzufuegen
 *
 * Web-Component (kein Build). Ueber GitHub Pages ausliefern und im
 * Desktop-Layout per "script" referenzieren. Tag-Name: <customer-id-widget>
 *
 * Vom Desktop injizierte Properties:
 *   bearerToken, organizationId, dataCenter, interactionData
 * -------------------------------------------------------------------------
 */
(function () {
  "use strict";

  // ============================ KONFIGURATION ============================
  const CONFIG = {
    baseUrlByDataCenter: {
      produs1: "https://api.wxcc-us1.cisco.com",
      prodeu1: "https://api.wxcc-eu1.cisco.com",
      prodeu2: "https://api.wxcc-eu2.cisco.com",
      prodanz1: "https://api.wxcc-anz1.cisco.com",
    },
    fallbackBaseUrl: "https://api.wxcc-eu1.cisco.com", // bestaetigt: eu1
    workspaceId: "682f3b007542bf078915f230",           // aus deinem GET

    paths: {
      // BESTAETIGT (GET) – Person per Alias (z. B. ANI) holen
      getByAlias: (ws, alias) =>
        `/admin/v1/api/person/workspace-id/${ws}/aliases/${encodeURIComponent(alias)}`,
      // BESTAETIGT (PATCH, Body {"customerId":[...]}) – Identities hinzufuegen
      addIdentities: (ws, pid) =>
        `/admin/v1/api/person/add-identities/workspace-id/${ws}/person-id/${pid}`,
      // BESTAETIGT (PATCH, Body {"customerId":[...]}) – Identities entfernen
      removeIdentities: (ws, pid) =>
        `/admin/v1/api/person/remove-identities/workspace-id/${ws}/person-id/${pid}`,
    },
    methods: { addIdentities: "PATCH", removeIdentities: "PATCH" },
    // WxCC PATCH-Endpunkte erwarten diesen Media-Type (nicht application/json)
    patchContentType: "application/json-patch+json",
  };
  // ======================================================================

  class CustomerIdWidget extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._p = {};
      this._person = null;
      this._rendered = false;
    }

    set bearerToken(v) { this._p.bearerToken = v; this._maybeAutoLoad(); }
    get bearerToken() { return this._p.bearerToken; }
    set organizationId(v) { this._p.organizationId = v; }
    set dataCenter(v) { this._p.dataCenter = v; }
    set interactionData(v) { this._p.interactionData = v; this._maybeAutoLoad(); }

    connectedCallback() { this._render(); this._maybeAutoLoad(); }

    _baseUrl() {
      const dc = String(this._p.dataCenter || "").toLowerCase();
      return CONFIG.baseUrlByDataCenter[dc] || CONFIG.fallbackBaseUrl;
    }

    // ANI aus interactionData ableiten (mehrere plausible Pfade)
    _extractAni(idata) {
      if (!idata) return "";
      const cands = [idata, idata.interaction, idata.task, idata.taskSelected];
      for (const node of cands) {
        if (!node) continue;
        const cad = node.callAssociatedData;
        if (cad && cad.ani && cad.ani.value) return String(cad.ani.value);
        const det = node.callAssociatedDetails;
        if (det && det.ani) return String(det.ani);
      }
      return "";
    }

    // Auto-Laden, sobald Token + ANI vorhanden sind
    _maybeAutoLoad() {
      if (!this._rendered || !this._p.bearerToken) return;
      const ani = this._extractAni(this._p.interactionData);
      if (ani && this._aliasInput && !this._aliasInput.value) {
        this._aliasInput.value = ani;
        if (!this._autoLoaded) { this._autoLoaded = true; this._load(); }
      }
    }

    async _api(path, method, body, contentType) {
      const headers = { "Authorization": "Bearer " + this._p.bearerToken };
      if (body) headers["Content-Type"] = contentType || "application/json";
      const res = await fetch(this._baseUrl() + path, {
        method: method,
        headers: headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (e) { /* non-json */ }
      if (!res.ok) throw new Error("HTTP " + res.status + " – " + (text || res.statusText));
      return json;
    }

    _personFrom(resp) {
      const d = resp && resp.data;
      return Array.isArray(d) ? (d[0] || null) : (d || null);
    }

    async _load() {
      const alias = (this._aliasInput.value || "").trim();
      if (!alias) { this._status("Bitte Rufnummer/Alias eingeben.", "warn"); return; }
      this._status("Lade …");
      try {
        const resp = await this._api(
          CONFIG.paths.getByAlias(CONFIG.workspaceId, alias), "GET");
        const person = this._personFrom(resp);
        if (!person || !person.id) {
          this._editArea.style.display = "none";
          this._status("Keine Person zu diesem Alias gefunden.", "warn");
          return;
        }
        this._person = person;
        this._name.textContent =
          [person.firstName, person.lastName].filter(Boolean).join(" ") || "(kein Name)";
        const cur = Array.isArray(person.customerId) ? person.customerId : [];
        this._cidInput.value = cur.join(", ");
        this._editArea.style.display = "block";
        this._status("Geladen.", "ok");
      } catch (e) {
        this._status("Fehler beim Laden: " + e.message, "err");
      }
    }

    async _save() {
      if (!this._person || !this._person.id) return;
      const pid = this._person.id;
      const ws = CONFIG.workspaceId;
      const oldVals = Array.isArray(this._person.customerId) ? this._person.customerId : [];
      const raw = (this._cidInput.value || "").trim();
      if (!raw) { this._status("Neue customerId ist leer.", "warn"); return; }
      const newVals = raw.split(",").map(s => s.trim()).filter(Boolean);

      const toRemove = oldVals.filter(v => !newVals.includes(v));
      const toAdd = newVals.filter(v => !oldVals.includes(v));
      if (!toRemove.length && !toAdd.length) { this._status("Keine Änderung.", "warn"); return; }

      this._status("Speichere …");
      try {
        if (toRemove.length) {
          await this._api(CONFIG.paths.removeIdentities(ws, pid),
            CONFIG.methods.removeIdentities, { customerId: toRemove }, CONFIG.patchContentType);
        }
        if (toAdd.length) {
          await this._api(CONFIG.paths.addIdentities(ws, pid),
            CONFIG.methods.addIdentities, { customerId: toAdd }, CONFIG.patchContentType);
        }
        this._status("Gespeichert.", "ok");
        await this._load(); // Kontrolle
      } catch (e) {
        this._status("Fehler beim Speichern: " + e.message, "err");
      }
    }

    _status(msg, kind) {
      if (!this._statusEl) return;
      this._statusEl.textContent = msg || "";
      this._statusEl.dataset.kind = kind || "";
    }

    _render() {
      this.shadowRoot.innerHTML = `
        <style>
          :host { display:block; font-family: inherit; color:#121212; }
          .box { padding:12px; max-width:420px; }
          h3 { margin:0 0 8px; font-size:14px; }
          label { display:block; font-size:12px; color:#535759; margin:8px 0 2px; }
          input { width:100%; box-sizing:border-box; padding:6px 8px;
                  border:1px solid #b9bcbe; border-radius:6px; font-size:13px; }
          .row { display:flex; gap:8px; align-items:end; }
          .row > div { flex:1; }
          button { padding:6px 12px; border:0; border-radius:16px; cursor:pointer;
                   background:#0051af; color:#fff; font-size:13px; }
          button.secondary { background:#e6e9ea; color:#121212; }
          .edit { display:none; margin-top:10px; padding-top:10px;
                  border-top:1px solid #e6e9ea; }
          .name { font-weight:600; font-size:13px; margin:2px 0 6px; }
          .status { min-height:16px; font-size:12px; margin-top:8px; }
          .status[data-kind="ok"]  { color:#0a7a3d; }
          .status[data-kind="warn"]{ color:#8a6d00; }
          .status[data-kind="err"] { color:#b3271e; }
        </style>
        <div class="box">
          <h3>Customer ID</h3>
          <div class="row">
            <div>
              <label>Rufnummer / Alias (ANI)</label>
              <input id="alias" placeholder="wird beim Anruf automatisch gefüllt" />
            </div>
            <button id="loadBtn" class="secondary">Laden</button>
          </div>

          <div class="edit" id="edit">
            <div class="name" id="name"></div>
            <label>customerId (mehrere per Komma)</label>
            <input id="cid" placeholder="customerId" />
            <div style="margin-top:8px;"><button id="saveBtn">Speichern</button></div>
          </div>

          <div class="status" id="status"></div>
        </div>
      `;
      this._aliasInput = this.shadowRoot.getElementById("alias");
      this._cidInput = this.shadowRoot.getElementById("cid");
      this._name = this.shadowRoot.getElementById("name");
      this._editArea = this.shadowRoot.getElementById("edit");
      this._statusEl = this.shadowRoot.getElementById("status");
      this.shadowRoot.getElementById("loadBtn")
        .addEventListener("click", () => { this._autoLoaded = true; this._load(); });
      this.shadowRoot.getElementById("saveBtn")
        .addEventListener("click", () => this._save());
      this._rendered = true;
    }
  }

  if (!customElements.get("customer-id-widget")) {
    customElements.define("customer-id-widget", CustomerIdWidget);
  }
})();
