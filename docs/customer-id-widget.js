/*
 * customer-id-widget.js
 * -------------------------------------------------------------------------
 * Kleines Zusatz-Widget fuer den Webex Contact Center Agent Desktop.
 * - liest die aktuelle customerId eines CJDS-Profils aus
 * - zeigt firstName / lastName (read-only) und customerId (editierbar)
 * - beim Speichern: alten customerId-Wert entfernen und neuen hinzufuegen
 *
 * Web-Component (kein Build noetig). Ueber GitHub Pages ausliefern und im
 * Desktop-Layout per "script": "https://<user>.github.io/<repo>/customer-id-widget.js"
 * referenzieren. Registrierter Tag-Name: <customer-id-widget>
 *
 * Auth/Kontext werden vom Desktop ueber Properties injiziert:
 *   bearerToken, organizationId, dataCenter, interactionData
 * -------------------------------------------------------------------------
 */
(function () {
  "use strict";

  // ============================ KONFIGURATION ============================
  const CONFIG = {
    // dataCenter (aus $STORE.app.datacenter) -> API Base URL
    baseUrlByDataCenter: {
      produs1: "https://api.wxcc-us1.cisco.com",
      prodeu1: "https://api.wxcc-eu1.cisco.com",
      prodeu2: "https://api.wxcc-eu2.cisco.com",
      prodanz1: "https://api.wxcc-anz1.cisco.com",
    },
    // Fallback, falls dataCenter unbekannt ist (dein bestaetigter Wert: eu1)
    fallbackBaseUrl: "https://api.wxcc-eu1.cisco.com",

    // Workspace-ID (aus deinem GET). Bei Bedarf anpassen.
    workspaceId: "682f3b007542bf078915f230",

    paths: {
      // BESTAETIGT (GET) – liefert das Person-Objekt inkl. Aliase
      getPerson: (ws, pid) =>
        `/admin/v1/api/person/workspace-id/${ws}?personId=${encodeURIComponent(pid)}`,

      // BESTAETIGT (PATCH, Body: {"customerId":[...]}) – fuegt Identities hinzu
      addIdentities: (ws, pid) =>
        `/admin/v1/api/person/add-identities/workspace-id/${ws}/person-id/${pid}`,

      // >>> BITTE IM POSTMAN VERIFIZIEREN <<<
      // Gegenstueck zum Entfernen. Name/Signatur evtl. anders (z.B. delete-identities).
      removeIdentities: (ws, pid) =>
        `/admin/v1/api/person/remove-identities/workspace-id/${ws}/person-id/${pid}`,
    },

    // HTTP-Methoden pro Aktion (falls dein Tenant abweicht, hier anpassen)
    methods: { addIdentities: "PATCH", removeIdentities: "PATCH" },
  };
  // ======================================================================

  class CustomerIdWidget extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._p = {};            // injizierte Properties
      this._person = null;     // geladenes Person-Objekt
      this._initialized = false;
    }

    // Desktop setzt Properties nach dem Erstellen -> Setter fangen sie ab
    set bearerToken(v) { this._p.bearerToken = v; this._maybeInit(); }
    get bearerToken() { return this._p.bearerToken; }
    set organizationId(v) { this._p.organizationId = v; }
    set dataCenter(v) { this._p.dataCenter = v; }
    set interactionData(v) { this._p.interactionData = v; this._prefillFromInteraction(); }

    connectedCallback() { this._render(); this._maybeInit(); }

    // ---------------------------- Helpers ----------------------------
    _baseUrl() {
      const dc = String(this._p.dataCenter || "").toLowerCase();
      return CONFIG.baseUrlByDataCenter[dc] || CONFIG.fallbackBaseUrl;
    }

    _maybeInit() {
      if (this._initialized || !this._p.bearerToken || !this.shadowRoot.firstChild) return;
      this._initialized = true;
      this._prefillFromInteraction();
    }

    // Best-effort: Identitaet des aktuellen Kontakts vorbelegen.
    // HINWEIS: Zum Auto-Laden per Anrufer braeuchte es zusaetzlich einen
    // "Search-by-Alias -> personId"-Endpunkt. Bis dahin traegt der Agent
    // die Person-ID ein (oder du ergaenzt hier die Aufloesung).
    _prefillFromInteraction() {
      try {
        const idata = this._p.interactionData;
        if (!idata || !this._idInput) return;
        const i = idata.interaction || idata;
        const ani = i && (i.callAssociatedData && i.callAssociatedData.ani &&
                          i.callAssociatedData.ani.value);
        if (ani && !this._idInput.value) this._hint("Aktueller Kontakt: " + ani);
      } catch (e) { /* ignore */ }
    }

    async _api(path, method, body) {
      const res = await fetch(this._baseUrl() + path, {
        method: method,
        headers: {
          "Authorization": "Bearer " + this._p.bearerToken,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (e) { /* non-json */ }
      if (!res.ok) throw new Error("HTTP " + res.status + " – " + (text || res.statusText));
      return json;
    }

    // ---------------------------- Aktionen ---------------------------
    async _load() {
      const pid = (this._idInput.value || "").trim();
      if (!pid) { this._status("Bitte Person-ID eingeben.", "warn"); return; }
      this._status("Lade …");
      try {
        const resp = await this._api(
          CONFIG.paths.getPerson(CONFIG.workspaceId, pid), "GET");
        const person = this._personFrom(resp);
        if (!person) { this._status("Keine Person gefunden.", "warn"); return; }
        this._person = person;
        this._person._pid = pid;
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

    _personFrom(resp) {
      const d = resp && resp.data;
      return Array.isArray(d) ? (d[0] || null) : (d || null);
    }

    async _save() {
      if (!this._person) return;
      const pid = this._person._pid;
      const ws = CONFIG.workspaceId;
      const oldVals = Array.isArray(this._person.customerId) ? this._person.customerId : [];
      const newVal = (this._cidInput.value || "").trim();
      if (!newVal) { this._status("Neue customerId ist leer.", "warn"); return; }
      const newVals = newVal.split(",").map(s => s.trim()).filter(Boolean);

      this._status("Speichere …");
      try {
        // 1) alte customerId-Werte entfernen (nur die, die nicht erhalten bleiben)
        const toRemove = oldVals.filter(v => !newVals.includes(v));
        if (toRemove.length) {
          await this._api(
            CONFIG.paths.removeIdentities(ws, pid),
            CONFIG.methods.removeIdentities,
            { customerId: toRemove });
        }
        // 2) neue customerId-Werte hinzufuegen (nur die, die neu sind)
        const toAdd = newVals.filter(v => !oldVals.includes(v));
        if (toAdd.length) {
          await this._api(
            CONFIG.paths.addIdentities(ws, pid),
            CONFIG.methods.addIdentities,
            { customerId: toAdd });
        }
        this._status("Gespeichert.", "ok");
        await this._load(); // frisch nachladen zur Kontrolle
      } catch (e) {
        this._status("Fehler beim Speichern: " + e.message, "err");
      }
    }

    // ---------------------------- UI --------------------------------
    _status(msg, kind) {
      if (!this._statusEl) return;
      this._statusEl.textContent = msg || "";
      this._statusEl.dataset.kind = kind || "";
    }
    _hint(msg) { if (this._hintEl) this._hintEl.textContent = msg || ""; }

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
          .hint { font-size:11px; color:#8b9096; margin-top:4px; }
        </style>
        <div class="box">
          <h3>Customer ID</h3>
          <div class="row">
            <div>
              <label>Person-ID</label>
              <input id="pid" placeholder="z. B. 68d5476c0dbfb67c9fe75643" />
            </div>
            <button id="loadBtn" class="secondary">Laden</button>
          </div>
          <div class="hint" id="hint"></div>

          <div class="edit" id="edit">
            <div class="name" id="name"></div>
            <label>customerId (mehrere per Komma)</label>
            <input id="cid" placeholder="customerId" />
            <div style="margin-top:8px;">
              <button id="saveBtn">Speichern</button>
            </div>
          </div>

          <div class="status" id="status"></div>
        </div>
      `;
      this._idInput = this.shadowRoot.getElementById("pid");
      this._cidInput = this.shadowRoot.getElementById("cid");
      this._name = this.shadowRoot.getElementById("name");
      this._editArea = this.shadowRoot.getElementById("edit");
      this._statusEl = this.shadowRoot.getElementById("status");
      this._hintEl = this.shadowRoot.getElementById("hint");
      this.shadowRoot.getElementById("loadBtn")
        .addEventListener("click", () => this._load());
      this.shadowRoot.getElementById("saveBtn")
        .addEventListener("click", () => this._save());
    }
  }

  if (!customElements.get("customer-id-widget")) {
    customElements.define("customer-id-widget", CustomerIdWidget);
  }
})();
