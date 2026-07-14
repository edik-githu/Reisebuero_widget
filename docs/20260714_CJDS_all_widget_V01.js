/*
 * 20260714_CJDS_all_widget_V01.js
 * -------------------------------------------------------------------------
 * CJDS-Zusatz-Widget fuer den Webex Contact Center Agent Desktop ("CJDS all").
 *
 * Beim eingehenden Anruf:
 *   1. ANI aus interactionData lesen
 *   2. Person per Alias (ANI) holen -> GET .../aliases/{ani}
 *   3. Name (read-only), Workspace-ID, Person-ID anzeigen
 *   4. Alias-Typen editierbar: customerId, phone, email, temporaryId, socialId
 *      (jeder Wert eigene Zeile; hinzufuegen/entfernen)
 *   5. Speichern: entfernte Werte (typuebergreifend) via remove-identities
 *      (reines Array), neue Werte je Typ via add-identities (Objekt).
 *
 * Web-Component (kein Build). Tag-Name: <cjds-all-widget>
 * Vom Desktop injiziert: bearerToken, organizationId, dataCenter, interactionData
 * -------------------------------------------------------------------------
 */
(function () {
  "use strict";

  const CONFIG = {
    baseUrlByDataCenter: {
      produs1: "https://api.wxcc-us1.cisco.com",
      prodeu1: "https://api.wxcc-eu1.cisco.com",
      prodeu2: "https://api.wxcc-eu2.cisco.com",
      prodanz1: "https://api.wxcc-anz1.cisco.com",
    },
    fallbackBaseUrl: "https://api.wxcc-eu1.cisco.com",
    fallbackWorkspaceId: "682f3b007542bf078915f230",

    paths: {
      getByAlias: (ws, alias) =>
        `/admin/v1/api/person/workspace-id/${ws}/aliases/${encodeURIComponent(alias)}`,
      addIdentities: (ws, pid) =>
        `/admin/v1/api/person/add-identities/workspace-id/${ws}/person-id/${pid}`,
      removeIdentities: (ws, pid) =>
        `/admin/v1/api/person/remove-identities/workspace-id/${ws}/person-id/${pid}`,
    },
    patchContentType: "application/json-patch+json",
  };

  // Editierbare Alias-Typen (Reihenfolge = Anzeigereihenfolge)
  const TYPES = ["customerId", "phone", "email", "temporaryId", "socialId"];

  class CjdsAllWidget extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._p = {};
      this._person = null;
      this._original = {};   // Snapshot je Typ zum Diffen
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
    _ws() { return (this._person && this._person.workspaceId) || CONFIG.fallbackWorkspaceId; }

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
      if (body !== undefined) headers["Content-Type"] = contentType || "application/json";
      const res = await fetch(this._baseUrl() + path, {
        method: method, headers: headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
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
        const resp = await this._api(CONFIG.paths.getByAlias(this._ws(), alias), "GET");
        const person = this._personFrom(resp);
        if (!person || !person.id) {
          this._details.style.display = "none";
          this._status("Keine Person zu diesem Alias gefunden.", "warn");
          return;
        }
        this._person = person;
        this._original = {};
        TYPES.forEach(t => {
          this._original[t] = Array.isArray(person[t]) ? person[t].slice() : [];
        });
        this._renderDetails();
        this._details.style.display = "block";
        this._status("Geladen.", "ok");
      } catch (e) {
        this._status("Fehler beim Laden: " + e.message, "err");
      }
    }

    async _save() {
      if (!this._person || !this._person.id) return;
      const ws = this._ws(), pid = this._person.id;

      const current = {};
      TYPES.forEach(t => { current[t] = this._readRows(t); });

      const toRemoveAll = [];
      const addByType = {};
      TYPES.forEach(t => {
        const orig = this._original[t] || [];
        const cur = current[t] || [];
        orig.forEach(v => { if (!cur.includes(v)) toRemoveAll.push(v); });
        const adds = cur.filter(v => !orig.includes(v));
        if (adds.length) addByType[t] = adds;
      });

      if (!toRemoveAll.length && !Object.keys(addByType).length) {
        this._status("Keine Änderung.", "warn"); return;
      }
      this._status("Speichere …");
      try {
        if (toRemoveAll.length) {
          await this._api(CONFIG.paths.removeIdentities(ws, pid), "PATCH",
            toRemoveAll, CONFIG.patchContentType);
        }
        for (const t of Object.keys(addByType)) {
          const body = {}; body[t] = addByType[t];
          await this._api(CONFIG.paths.addIdentities(ws, pid), "PATCH",
            body, CONFIG.patchContentType);
        }
        this._status("Gespeichert.", "ok");
        await this._load();
      } catch (e) {
        this._status("Fehler beim Speichern: " + e.message, "err");
      }
    }

    // ---- Zeilen-Handling je Typ ----
    _rowsContainer(type) { return this.shadowRoot.getElementById("rows-" + type); }
    _readRows(type) {
      const inputs = this._rowsContainer(type).querySelectorAll("input");
      const vals = [];
      inputs.forEach(i => { const v = i.value.trim(); if (v && !vals.includes(v)) vals.push(v); });
      return vals;
    }
    _addRow(type, value) {
      const wrap = document.createElement("div");
      wrap.className = "aliasRow";
      const inp = document.createElement("input");
      inp.type = "text"; inp.value = value || ""; inp.placeholder = type;
      const del = document.createElement("button");
      del.type = "button"; del.className = "del"; del.textContent = "×";
      del.title = "Entfernen";
      del.addEventListener("click", () => wrap.remove());
      wrap.appendChild(inp); wrap.appendChild(del);
      this._rowsContainer(type).appendChild(wrap);
    }

    _renderDetails() {
      const p = this._person;
      this._name.textContent =
        [p.firstName, p.lastName].filter(Boolean).join(" ") || "(kein Name)";
      this._wsId.textContent = "Workspace ID: " + this._ws();
      this._personId.textContent = "Person ID: " + p.id;
      TYPES.forEach(t => {
        const c = this._rowsContainer(t);
        c.innerHTML = "";
        (this._original[t] || []).forEach(v => this._addRow(t, v));
      });
    }

    _status(msg, kind) {
      if (!this._statusEl) return;
      this._statusEl.textContent = msg || "";
      this._statusEl.dataset.kind = kind || "";
    }

    _render() {
      const typeSections = TYPES.map(t => `
        <div class="typeBlock">
          <div class="typeHead">
            <span class="typeLabel">${t}</span>
            <button type="button" class="add" data-type="${t}">+ hinzufügen</button>
          </div>
          <div class="rows" id="rows-${t}"></div>
        </div>`).join("");

      this.shadowRoot.innerHTML = `
        <style>
          :host { display:block; font-family: inherit; color:#121212; }
          .box { padding:12px; max-width:460px; }
          h3 { margin:0 0 8px; font-size:14px; }
          label { display:block; font-size:12px; color:#535759; margin:8px 0 2px; }
          input { width:100%; box-sizing:border-box; padding:6px 8px;
                  border:1px solid #b9bcbe; border-radius:6px; font-size:13px; }
          .row { display:flex; gap:8px; align-items:end; }
          .row > div { flex:1; }
          button { padding:6px 12px; border:0; border-radius:16px; cursor:pointer;
                   background:#0051af; color:#fff; font-size:13px; }
          button.secondary { background:#e6e9ea; color:#121212; }
          .details { display:none; margin-top:10px; padding-top:10px;
                     border-top:1px solid #e6e9ea; }
          .name { font-weight:600; font-size:14px; margin:2px 0 4px; }
          .meta { font-size:11px; color:#6b7073; }
          .typeBlock { margin-top:12px; }
          .typeHead { display:flex; justify-content:space-between; align-items:center; }
          .typeLabel { font-size:12px; font-weight:600; color:#374a5a; }
          .add { background:transparent; color:#0051af; padding:2px 4px; font-size:12px; }
          .aliasRow { display:flex; gap:6px; align-items:center; margin-top:4px; }
          .aliasRow input { flex:1; }
          .del { background:#f3d6d3; color:#b3271e; border-radius:50%;
                 width:24px; height:24px; padding:0; line-height:1; flex:0 0 auto; }
          .saveRow { margin-top:14px; }
          .status { min-height:16px; font-size:12px; margin-top:8px; }
          .status[data-kind="ok"]  { color:#0a7a3d; }
          .status[data-kind="warn"]{ color:#8a6d00; }
          .status[data-kind="err"] { color:#b3271e; }
        </style>
        <div class="box">
          <h3>CJDS all</h3>
          <div class="row">
            <div>
              <label>Rufnummer / Alias (ANI)</label>
              <input id="alias" placeholder="wird beim Anruf automatisch gefüllt" />
            </div>
            <button id="loadBtn" class="secondary">Laden</button>
          </div>

          <div class="details" id="details">
            <div class="name" id="name"></div>
            <div class="meta" id="wsId"></div>
            <div class="meta" id="personId"></div>
            ${typeSections}
            <div class="saveRow"><button id="saveBtn">Speichern</button></div>
          </div>

          <div class="status" id="status"></div>
        </div>
      `;
      this._aliasInput = this.shadowRoot.getElementById("alias");
      this._details = this.shadowRoot.getElementById("details");
      this._name = this.shadowRoot.getElementById("name");
      this._wsId = this.shadowRoot.getElementById("wsId");
      this._personId = this.shadowRoot.getElementById("personId");
      this._statusEl = this.shadowRoot.getElementById("status");
      this.shadowRoot.getElementById("loadBtn")
        .addEventListener("click", () => { this._autoLoaded = true; this._load(); });
      this.shadowRoot.getElementById("saveBtn")
        .addEventListener("click", () => this._save());
      this.shadowRoot.querySelectorAll("button.add").forEach(btn => {
        btn.addEventListener("click", () => this._addRow(btn.dataset.type, ""));
      });
      this._rendered = true;
    }
  }

  if (!customElements.get("cjds-all-widget")) {
    customElements.define("cjds-all-widget", CjdsAllWidget);
  }
})();
