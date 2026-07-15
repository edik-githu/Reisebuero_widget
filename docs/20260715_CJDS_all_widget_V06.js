/*
 * 20260715_CJDS_all_widget_V06.js
 * -------------------------------------------------------------------------
 * CJDS "CJDS all" – zwei Spalten (LINKS Anrufer via ANI, RECHTS Suche).
 * Suche kombiniert:
 *   0) MERGE-Button in der Mitte: fuehrt zwei Datensaetze zusammen
 *      POST .../person/merge/workspace-id/{ws}/primary-person-id/{primaryId}
 *      Body {"personIdsToMerge":[secondaryId]} -> 202 Accepted (asynchron)
 *      ACHTUNG: Der Primary behaelt seinen firstName/lastName. Der Name des
 *      gemergten Datensatzes wandert NICHT mit (getestet). Aliase werden vereint.
 *   1) exakter Alias-Treffer (GET .../aliases/{wert})
 *   2) sonst Namenssuche exakt (GET ...?filter=lastName==wert / firstName==wert)
 *      -> 1 Treffer: direkt laden; mehrere: anklickbare Ergebnisliste.
 * Editierbare Alias-Typen: customerId, phone, email, temporaryId, socialId.
 * Speichern: remove-identities (reines Array) + add-identities (Objekt),
 *            Content-Type application/json-patch+json.
 * Web-Component. Tag: <cjds-all-widget>
 * Injiziert: bearerToken, organizationId, dataCenter, interactionData
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
      getByFilter: (ws, field, value) =>
        `/admin/v1/api/person/workspace-id/${ws}?filter=${encodeURIComponent(field + "==" + value)}`,
      addIdentities: (ws, pid) =>
        `/admin/v1/api/person/add-identities/workspace-id/${ws}/person-id/${pid}`,
      removeIdentities: (ws, pid) =>
        `/admin/v1/api/person/remove-identities/workspace-id/${ws}/person-id/${pid}`,
      merge: (ws, primaryId) =>
        `/admin/v1/api/person/merge/workspace-id/${ws}/primary-person-id/${primaryId}`,
    },
    patchContentType: "application/json-patch+json",
    mergeContentType: "application/json",
    // Felder, die bei der Namenssuche geprueft werden
    nameFields: ["lastName", "firstName"],
  };

  const TYPES = ["customerId", "phone", "email", "temporaryId", "socialId"];

  function el(tag, cls, txt) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }

  class PersonPanel {
    constructor(ctx, opts) {
      this.ctx = ctx;
      this.opts = opts;
      this._person = null;
      this._original = {};
      this._rows = {};
      this.el = this._build();
    }

    _ws() { return (this._person && this._person.workspaceId) || this.ctx.fallbackWs; }
    setAlias(v) { this._aliasInput.value = v; }
    getAlias() { return (this._aliasInput.value || "").trim(); }
    getPerson() { return this._person; }
    _notify() { if (this.ctx.onPersonChange) this.ctx.onPersonChange(); }
    async reload() { if (this.getAlias()) await this.load(); }

    _build() {
      const panel = el("div", "panel");
      panel.appendChild(el("div", "panelHead", this.opts.heading));

      const row = el("div", "row");
      const inWrap = el("div");
      inWrap.appendChild(el("label", null, this.opts.aliasLabel || "Rufnummer / Alias"));
      this._aliasInput = el("input");
      this._aliasInput.placeholder = this.opts.placeholder || "";
      this._aliasInput.addEventListener("keydown", (e) => { if (e.key === "Enter") this.load(); });
      inWrap.appendChild(this._aliasInput);
      const loadBtn = el("button", "secondary", "Laden");
      loadBtn.type = "button";
      loadBtn.addEventListener("click", () => this.load());
      row.appendChild(inWrap);
      row.appendChild(loadBtn);
      panel.appendChild(row);

      this._results = el("div", "results");
      panel.appendChild(this._results);

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
      const q = this.getAlias();
      if (!q) { this.status("Bitte Alias oder Name eingeben.", "warn"); return; }
      this.status("Suche …");
      this._clearResults();
      try {
        // 1) exakter Alias-Treffer
        let person = null;
        try {
          const resp = await this.ctx.api(CONFIG.paths.getByAlias(this._ws(), q), "GET");
          person = this._personFrom(resp);
        } catch (e) {
          if (!/HTTP 404/.test(e.message)) throw e;
        }
        if (person && person.id) { this._showPerson(person); this.status("Geladen.", "ok"); return; }

        // 2) Namenssuche (exakt) ueber firstName / lastName
        const persons = await this._searchByName(q);
        if (persons.length === 0) {
          this._person = null;
          this._details.classList.remove("show");
          this._notify();
          this.status("Kein Treffer für Alias oder Name.", "warn");
        } else if (persons.length === 1) {
          this._showPerson(persons[0]); this.status("Geladen.", "ok");
        } else {
          this._person = null;
          this._notify();
          this._renderResults(persons);
          this.status(persons.length + " Treffer – bitte auswählen.", "warn");
        }
      } catch (e) {
        this._person = null;
        this._details.classList.remove("show");
        this._notify();
        this.status("Fehler bei der Suche: " + e.message, "err");
      }
    }

    async _searchByName(q) {
      const map = {};
      for (const field of CONFIG.nameFields) {
        try {
          const resp = await this.ctx.api(
            CONFIG.paths.getByFilter(this._ws(), field, q), "GET");
          const d = resp && resp.data;
          const arr = Array.isArray(d) ? d : (d ? [d] : []);
          arr.forEach((p) => { if (p && p.id) map[p.id] = p; });
        } catch (e) {
          if (!/HTTP 404/.test(e.message)) throw e;
        }
      }
      return Object.values(map);
    }

    _renderResults(persons) {
      this._details.classList.remove("show");
      this._results.innerHTML = "";
      this._results.appendChild(el("div", "resHead", persons.length + " Treffer:"));
      persons.forEach((p) => {
        const name = [p.firstName, p.lastName].filter(Boolean).join(" ") || "(kein Name)";
        const extra = (Array.isArray(p.phone) && p.phone[0]) ||
                      (Array.isArray(p.email) && p.email[0]) || p.id;
        const b = el("button", "resItem");
        b.type = "button";
        b.appendChild(el("span", "resName", name));
        b.appendChild(el("span", "resExtra", " · " + extra));
        b.addEventListener("click", () => {
          this._clearResults();
          this._showPerson(p);
          this.status("Geladen.", "ok");
        });
        this._results.appendChild(b);
      });
      this._results.classList.add("show");
    }

    _clearResults() {
      this._results.innerHTML = "";
      this._results.classList.remove("show");
    }

    _showPerson(person) {
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
      this._notify();
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
          .results { display:none; margin-top:8px; }
          .results.show { display:block; }
          .resHead { font-size:12px; color:#535759; margin-bottom:4px; }
          .resItem { display:block; width:100%; text-align:left; background:#f4f6f7;
                     color:#121212; border-radius:8px; padding:8px 10px; margin-top:4px; }
          .resName { font-weight:600; font-size:13px; }
          .resExtra { color:#6b7073; font-size:12px; }
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

          /* Merge-Steuerung in der Mitte */
          .mergeBox { flex:0 0 150px; align-self:center; text-align:center; }
          .mergeBtn { width:100%; }
          .mergeBtn:disabled { background:#e6e9ea; color:#8b9096; cursor:not-allowed; }
          .mergeHint { font-size:11px; color:#6b7073; margin-top:6px; line-height:1.35; }

          /* Bestaetigungsdialog */
          .overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.35);
                     z-index:9999; align-items:center; justify-content:center; }
          .overlay.show { display:flex; }
          .dialog { background:#fff; border-radius:10px; padding:16px; width:min(560px,92vw);
                    max-height:86vh; overflow-y:auto; box-shadow:0 8px 30px rgba(0,0,0,.25); }
          .dialog h4 { margin:0 0 10px; font-size:15px; }
          .cmp { display:flex; gap:10px; }
          .cmpCol { flex:1; border:1px solid #e6e9ea; border-radius:8px; padding:8px; }
          .cmpRole { font-size:11px; font-weight:700; text-transform:uppercase; }
          .cmpRole.primary { color:#0a7a3d; }
          .cmpRole.secondary { color:#b3271e; }
          .cmpName { font-weight:600; font-size:13px; margin:3px 0; }
          .cmpMeta { font-size:11px; color:#6b7073; word-break:break-all; }
          .radios { margin:12px 0 6px; }
          .radios label { display:flex; align-items:center; gap:6px; font-size:12px;
                          color:#121212; margin:4px 0; }
          .radios input { width:auto; }
          .warnBox { background:#fdf3d8; border:1px solid #e5c76b; border-radius:6px;
                     padding:8px; font-size:12px; color:#6b5200; margin-top:8px; }
          .warnBox.hide { display:none; }
          .dangerBox { background:#fbe6e4; border:1px solid #e6a9a3; border-radius:6px;
                       padding:8px; font-size:12px; color:#8c1d16; margin-top:8px; }
          .dlgBtns { display:flex; justify-content:flex-end; gap:8px; margin-top:14px; }
          .dlgStatus { font-size:12px; margin-top:8px; min-height:16px; }
        </style>
        <div class="wrap">
          <h3>CJDS all</h3>
          <div class="cols" id="cols"></div>
        </div>

        <div class="overlay" id="overlay">
          <div class="dialog">
            <h4>Datensätze zusammenführen</h4>
            <div class="cmp" id="cmp"></div>

            <div class="radios">
              <label><input type="radio" name="primarySide" value="right" checked>
                Primary: <b>Suche (rechts)</b> – behält Name und nimmt die Aliase auf</label>
              <label><input type="radio" name="primarySide" value="left">
                Primary: <b>Aktueller Anrufer (links)</b></label>
            </div>

            <div class="warnBox hide" id="dlgWarn"></div>
            <div class="dangerBox">
              Der Primary behält seinen Vor-/Nachnamen – der Name des anderen Datensatzes
              wandert nicht mit. Die Aliase werden zusammengeführt. Der Vorgang ist
              voraussichtlich nicht umkehrbar.
            </div>

            <div class="dlgStatus" id="dlgStatus"></div>
            <div class="dlgBtns">
              <button type="button" class="secondary" id="dlgCancel">Abbrechen</button>
              <button type="button" id="dlgOk">Zusammenführen</button>
            </div>
          </div>
        </div>
      `;
      const ctx = { api: (p, m, b, ct) => this._api(p, m, b, ct),
                    fallbackWs: CONFIG.fallbackWorkspaceId,
                    onPersonChange: () => this._updateMergeState() };
      this._left = new PersonPanel(ctx, {
        heading: "Aktueller Anrufer",
        aliasLabel: "Rufnummer / Alias",
        placeholder: "wird beim Anruf automatisch gefüllt",
      });
      this._right = new PersonPanel(ctx, {
        heading: "Suche",
        aliasLabel: "Alias oder Name",
        placeholder: "Alias oder Name (exakt), z. B. Klocke",
      });
      const cols = this.shadowRoot.getElementById("cols");
      cols.appendChild(this._left.el);

      // Merge-Steuerung zwischen den Panels
      const mergeBox = el("div", "mergeBox");
      this._mergeBtn = el("button", "mergeBtn", "Zusammenführen");
      this._mergeBtn.type = "button";
      this._mergeBtn.disabled = true;
      this._mergeBtn.addEventListener("click", () => this._openDialog());
      this._mergeHint = el("div", "mergeHint", "Beide Seiten laden, um zusammenzuführen.");
      mergeBox.appendChild(this._mergeBtn);
      mergeBox.appendChild(this._mergeHint);
      cols.appendChild(mergeBox);

      cols.appendChild(this._right.el);

      this._overlay = this.shadowRoot.getElementById("overlay");
      this._dlgStatus = this.shadowRoot.getElementById("dlgStatus");
      this._dlgWarn = this.shadowRoot.getElementById("dlgWarn");
      this.shadowRoot.getElementById("dlgCancel")
        .addEventListener("click", () => this._closeDialog());
      this.shadowRoot.getElementById("dlgOk")
        .addEventListener("click", () => this._doMerge());
      this.shadowRoot.querySelectorAll('input[name="primarySide"]').forEach((r) => {
        r.addEventListener("change", () => this._renderDialogBody());
      });
      this._overlay.addEventListener("click", (e) => {
        if (e.target === this._overlay) this._closeDialog();
      });

      this._rendered = true;
    }

    // ---------------- Merge-Logik ----------------
    _updateMergeState() {
      if (!this._mergeBtn) return;
      const l = this._left.getPerson(), r = this._right.getPerson();
      if (!l || !r) {
        this._mergeBtn.disabled = true;
        this._mergeHint.textContent = "Beide Seiten laden, um zusammenzuführen.";
      } else if (l.id === r.id) {
        this._mergeBtn.disabled = true;
        this._mergeHint.textContent = "Beide Seiten zeigen dieselbe Person.";
      } else {
        this._mergeBtn.disabled = false;
        this._mergeHint.textContent = "Zwei verschiedene Datensätze geladen.";
      }
    }

    _primarySide() {
      const r = this.shadowRoot.querySelector('input[name="primarySide"]:checked');
      return r ? r.value : "right";
    }

    _nameOf(p) {
      return [p.firstName, p.lastName].filter(Boolean).join(" ");
    }

    _renderDialogBody() {
      const l = this._left.getPerson(), r = this._right.getPerson();
      if (!l || !r) return;
      const side = this._primarySide();
      const primary = side === "right" ? r : l;
      const secondary = side === "right" ? l : r;
      const primaryLabel = side === "right" ? "Suche (rechts)" : "Aktueller Anrufer (links)";
      const secondaryLabel = side === "right" ? "Aktueller Anrufer (links)" : "Suche (rechts)";

      const cmp = this.shadowRoot.getElementById("cmp");
      cmp.innerHTML = "";
      [[primary, "PRIMARY – bleibt bestehen", primaryLabel, "primary"],
       [secondary, "wird eingemergt", secondaryLabel, "secondary"]].forEach(
        ([p, role, where, cls]) => {
          const col = el("div", "cmpCol");
          col.appendChild(el("div", "cmpRole " + cls, role));
          col.appendChild(el("div", "cmpName", this._nameOf(p) || "(kein Name)"));
          col.appendChild(el("div", "cmpMeta", where));
          col.appendChild(el("div", "cmpMeta", "Person ID: " + p.id));
          const aliases = Array.isArray(p.aliases) ? p.aliases : [];
          col.appendChild(el("div", "cmpMeta",
            aliases.length ? "Aliase: " + aliases.join(", ") : "Aliase: –"));
          cmp.appendChild(col);
        });

      // Warnungen
      const warns = [];
      const pn = this._nameOf(primary), sn = this._nameOf(secondary);
      if (!pn && sn) {
        warns.push("Der Primary hat keinen Namen, der andere Datensatz heißt \u201e" + sn +
                   "\u201c. Nach dem Merge bleibt der Datensatz ohne Namen. " +
                   "Ggf. die andere Seite als Primary wählen.");
      } else if (pn && sn && pn.toLowerCase() !== sn.toLowerCase()) {
        warns.push("Die Namen unterscheiden sich (\u201e" + pn + "\u201c vs. \u201e" + sn +
                   "\u201c). Bitte prüfen, ob es wirklich dieselbe Person ist.");
      }
      if (warns.length) {
        this._dlgWarn.textContent = warns.join(" ");
        this._dlgWarn.classList.remove("hide");
      } else {
        this._dlgWarn.textContent = "";
        this._dlgWarn.classList.add("hide");
      }
    }

    _openDialog() {
      this._dlgStatus.textContent = "";
      this._renderDialogBody();
      this._overlay.classList.add("show");
    }

    _closeDialog() { this._overlay.classList.remove("show"); }

    async _doMerge() {
      const l = this._left.getPerson(), r = this._right.getPerson();
      if (!l || !r || l.id === r.id) return;
      const side = this._primarySide();
      const primary = side === "right" ? r : l;
      const secondary = side === "right" ? l : r;
      const ws = primary.workspaceId || CONFIG.fallbackWorkspaceId;

      this._dlgStatus.textContent = "Führe zusammen …";
      try {
        await this._api(CONFIG.paths.merge(ws, primary.id), "POST",
          { personIdsToMerge: [secondary.id] }, CONFIG.mergeContentType);
        this._dlgStatus.textContent = "Zusammengeführt (202) – lade neu …";
        // 202 = asynchron: kurz warten, dann beide Seiten neu laden
        await new Promise((res) => setTimeout(res, 2000));
        this._closeDialog();
        await this._left.reload();
        await this._right.reload();
      } catch (e) {
        this._dlgStatus.textContent = "Fehler beim Zusammenführen: " + e.message;
      }
    }
  }

  if (!customElements.get("cjds-all-widget")) {
    customElements.define("cjds-all-widget", CjdsAllWidget);
  }
})();
