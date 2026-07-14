/*
 * 20260714_CJDS_all_widget_V03.js
 * -------------------------------------------------------------------------
 * CJDS "CJDS all" – Zwei-Spalten-Ansicht:
 *   LINKS  "Aktueller Anrufer": Auto-Load per ANI aus interactionData
 *   RECHTS "Suche":             manuelle Alias-Suche, Ergebnis parallel daneben
 * Beide Spalten unabhaengig lad- und speicherbar.
 *
 * Editierbare Alias-Typen: customerId, phone, email, temporaryId, socialId
 * (jeder Wert eigene Zeile; hinzufuegen/entfernen).
 * Speichern: entfernte Werte via remove-identities (reines Array),
 *            neue Werte je Typ via add-identities (Objekt) – Content-Type
 *            application/json-patch+json.
 *
 * Web-Component (kein Build). Tag: <cjds-all-widget>
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

  const TYPES = ["customerId", "phone", "email", "temporaryId", "socialId"];

  function el(tag, cls, txt) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }

  // Ein eigenstaendiges Personen-Panel (Laden, Anzeigen, Bearbeiten, Speichern)
  class PersonPanel {
    constructor(ctx, opts) {
      this.ctx = ctx;                 // { api(path,method,body,ct), fallbackWs }
      this.opts = opts;               // { heading, placeholder }
      this._person = null;
      this._original = {};
      this._rows = {};                // type -> container element
      this.el = this._build();
    }

    _ws() { return (this._person && this._person.workspaceId) || this.ctx.fallbackWs; }
    setAlias(v) { this._aliasInput.value = v; }
    getAlias() { return (this._aliasInput.value || "").trim(); }

    _build() {
      const panel = el("div", "panel");

      panel.appendChild(el("div", "panelHead", this.opts.heading));

      const row = el("div", "row");
      const inWrap = el("div");
      inWrap.appendChild(el("label", null, "Rufnummer / Alias"));
      this._aliasInput = el("input");
      this._aliasInput.placeholder = this.opts.placeholder || "";
      this._aliasInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") this.load();
      });
      inWrap.appendChild(this._aliasInput);
      const loadBtn = el("button", "secondary", "Laden");
      loadBtn.type = "button";
      loadBtn.addEventListener("click", () => this.load());
      row.appendChild(inWrap);
      row.appendChild(loadBtn);
      panel.appendChild(row);

      this._details = el("div", "details");
      this._name = el("div", "name");
      this._wsId = el("div", "meta");
      this._personId = el("div", "meta");
      this._details.appendChild(this._name);
      this._details.appendChild(this._wsId);
      this._details.appendChild(this._personId);

      const scroll = el("div", "panelScroll");
      TYPES.forEach((t) => {
        const block = el("div", "typeBlock");
        const head = el("div", "typeHead");
        head.appendChild(el("span", "typeLabel", t));
        const addBtn = el("button", "add", "+ hinzufügen");
        addBtn.type = "button";
        addBtn.addEventListener("click", () => this._addRow(t, ""));
        head.appendChild(addBtn);
        block.appendChild(head);
        const rows = el("div", "rows");
        this._rows[t] = rows;
        block.appendChild(rows);
        scroll.appendChild(block);
      });
      this._details.appendChild(scroll);

      const footer = el("div", "footer");
      const saveBtn = el("button", null, "Speichern");
      saveBtn.type = "button";
      saveBtn.addEventListener("click", () => this.save());
      this._statusEl = el("span", "status");
      footer.appendChild(saveBtn);
      footer.appendChild(this._statusEl);
      this._details.appendChild(footer);

      panel.appendChild(this._details);
      return panel;
    }

    _addRow(type, value) {
      const wrap = el("div", "aliasRow");
      const inp = el("input");
      inp.type = "text"; inp.value = value || ""; inp.placeholder = type;
      const del = el("button", "del", "×");
      del.type = "button"; del.title = "Entfernen";
      del.addEventListener("click", () => wrap.remove());
      wrap.appendChild(inp); wrap.appendChild(del);
      this._rows[type].appendChild(wrap);
    }

    _readRows(type) {
      const vals = [];
      this._rows[type].querySelectorAll("input").forEach((i) => {
        const v = i.value.trim();
        if (v && !vals.includes(v)) vals.push(v);
      });
      return vals;
    }

    _personFrom(resp) {
      const d = resp && resp.data;
      return Array.isArray(d) ? (d[0] || null) : (d || null);
    }

    async load() {
      const alias = this.getAlias();
      if (!alias) { this.status("Bitte Rufnummer/Alias eingeben.", "warn"); return; }
      this.status("Lade …");
      try {
        const resp = await this.ctx.api(
          CONFIG.paths.getByAlias(this._ws(), alias), "GET");
        const person = this._personFrom(resp);
        if (!person || !person.id) {
          this._details.classList.remove("show");
          this.status("Keine Person zu diesem Alias gefunden.", "warn");
          return;
        }
        this._person = person;
        this._original = {};
        TYPES.forEach((t) => {
          this._original[t] = Array.isArray(person[t]) ? person[t].slice() : [];
        });
        this._name.textContent =
          [person.firstName, person.lastName].filter(Boolean).join(" ") || "(kein Name)";
        this._wsId.textContent = "Workspace ID: " + this._ws();
        this._personId.textContent = "Person ID: " + person.id;
        TYPES.forEach((t) => {
          this._rows[t].innerHTML = "";
          this._original[t].forEach((v) => this._addRow(t, v));
        });
        this._details.classList.add("show");
        this.status("Geladen.", "ok");
      } catch (e) {
        this.status("Fehler beim Laden: " + e.message, "err");
      }
    }

    async save() {
      if (!this._person || !this._person.id) return;
      const ws = this._ws(), pid = this._person.id;
      const toRemoveAll = [];
      const addByType = {};
      TYPES.forEach((t) => {
        const orig = this._original[t] || [];
        const cur = this._readRows(t);
        orig.forEach((v) => { if (!cur.includes(v)) toRemoveAll.push(v); });
        const adds = cur.filter((v) => !orig.includes(v));
        if (adds.length) addByType[t] = adds;
      });
      if (!toRemoveAll.length && !Object.keys(addByType).length) {
        this.status("Keine Änderung.", "warn"); return;
      }
      this.status("Speichere …");
      try {
        if (toRemoveAll.length) {
          await this.ctx.api(CONFIG.paths.removeIdentities(ws, pid), "PATCH",
            toRemoveAll, CONFIG.patchContentType);
        }
        for (const t of Object.keys(addByType)) {
          const body = {}; body[t] = addByType[t];
          await this.ctx.api(CONFIG.paths.addIdentities(ws, pid), "PATCH",
            body, CONFIG.patchContentType);
        }
        this.status("Gespeichert.", "ok");
        await this.load();
      } catch (e) {
        this.status("Fehler beim Speichern: " + e.message, "err");
      }
    }

    status(msg, kind) {
      this._statusEl.textContent = msg || "";
      this._statusEl.dataset.kind = kind || "";
    }
  }

  class CjdsAllWidget extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._p = {};
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
      if (!this._rendered || !this._p.bearerToken || !this._left) return;
      const ani = this._extractAni(this._p.interactionData);
      if (ani && !this._left.getAlias()) {
        this._left.setAlias(ani);
        if (!this._autoLoaded) { this._autoLoaded = true; this._left.load(); }
      }
    }

    _render() {
      this.shadowRoot.innerHTML = `
        <style>
          :host { display:block; height:100%; overflow-y:auto; box-sizing:border-box;
                  font-family: inherit; color:#121212; }
          .wrap { padding:12px; }
          h3 { margin:0 0 10px; font-size:14px; }
          .cols { display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap; }
          .panel { flex:1 1 320px; min-width:280px; border:1px solid #e6e9ea;
                   border-radius:8px; padding:10px; box-sizing:border-box; }
          .panelHead { font-size:13px; font-weight:700; color:#0051af; margin-bottom:8px; }
          label { display:block; font-size:12px; color:#535759; margin:6px 0 2px; }
          input { width:100%; box-sizing:border-box; padding:6px 8px;
                  border:1px solid #b9bcbe; border-radius:6px; font-size:13px; }
          .row { display:flex; gap:8px; align-items:end; }
          .row > div { flex:1; }
          button { padding:6px 12px; border:0; border-radius:16px; cursor:pointer;
                   background:#0051af; color:#fff; font-size:13px; }
          button.secondary { background:#e6e9ea; color:#121212; }
          .details { display:none; margin-top:10px; padding-top:10px;
                     border-top:1px solid #e6e9ea; }
          .details.show { display:block; }
          .name { font-weight:600; font-size:14px; margin:2px 0 4px; }
          .meta { font-size:11px; color:#6b7073; }
          .panelScroll { max-height:44vh; overflow-y:auto; margin-top:6px; }
          .typeBlock { margin-top:10px; }
          .typeHead { display:flex; justify-content:space-between; align-items:center; }
          .typeLabel { font-size:12px; font-weight:600; color:#374a5a; }
          .add { background:transparent; color:#0051af; padding:2px 4px; font-size:12px; }
          .aliasRow { display:flex; gap:6px; align-items:center; margin-top:4px; }
          .aliasRow input { flex:1; }
          .del { background:#f3d6d3; color:#b3271e; border-radius:50%;
                 width:24px; height:24px; padding:0; line-height:1; flex:0 0 auto; }
          .footer { margin-top:10px; padding-top:8px; border-top:1px solid #e6e9ea;
                    display:flex; align-items:center; gap:12px; }
          .status { min-height:16px; font-size:12px; }
          .status[data-kind="ok"]  { color:#0a7a3d; }
          .status[data-kind="warn"]{ color:#8a6d00; }
          .status[data-kind="err"] { color:#b3271e; }
        </style>
        <div class="wrap">
          <h3>CJDS all</h3>
          <div class="cols" id="cols"></div>
        </div>
      `;
      const ctx = { api: (p, m, b, ct) => this._api(p, m, b, ct),
                    fallbackWs: CONFIG.fallbackWorkspaceId };
      this._left = new PersonPanel(ctx, {
        heading: "Aktueller Anrufer",
        placeholder: "wird beim Anruf automatisch gefüllt",
      });
      this._right = new PersonPanel(ctx, {
        heading: "Suche",
        placeholder: "Alias: Rufnummer, E-Mail, customerId …",
      });
      const cols = this.shadowRoot.getElementById("cols");
      cols.appendChild(this._left.el);
      cols.appendChild(this._right.el);
      this._rendered = true;
    }
  }

  if (!customElements.get("cjds-all-widget")) {
    customElements.define("cjds-all-widget", CjdsAllWidget);
  }
})();
