[README.md](https://github.com/user-attachments/files/29967222/README.md)
# Customer ID Widget (CJDS Zusatz-Widget)

Kleines Zusatz-Widget für den Webex Contact Center Agent Desktop:
liest die `customerId` eines CJDS-Profils aus, zeigt Name (read-only) und
customerId (editierbar) und schreibt Änderungen zurück (alten Wert entfernen,
neuen hinzufügen). Kein Backend/Middleware nötig – als Web-Component im
Browser des Desktops.

## Was liegt wo im GitHub

```
<repo>/
├─ docs/
│  └─ customer-id-widget.js     ← die Web-Component (wird ausgeliefert)
└─ README.md
```

### GitHub Pages aktivieren
1. Datei nach `docs/customer-id-widget.js` legen und committen.
2. Repo → **Settings → Pages** → Source: Branch `main`, Ordner `/docs` → Save.
3. Ergebnis-URL: `https://<USER>.github.io/<REPO>/customer-id-widget.js`
   - **Nicht** `raw.githubusercontent.com` verwenden (falscher Content-Type).

### CSP Allowed List (Control Hub → Security Settings)
Beide Hosts eintragen, sonst blockt der Browser:
- Script-Host: `<USER>.github.io`
- API-Host (fetch): `api.wxcc-eu1.cisco.com`

## Desktop-Layout
Das mitgelieferte Layout enthält bereits einen **„Customer ID"-Tab** im
Interaktions-Panel für `agent`, `supervisor`, `supervisorAgent`.
Vor dem Upload in Control Hub nur die Script-URL ersetzen:

```
"script": "https://<USER>.github.io/<REPO>/customer-id-widget.js"
```

Der Tag-Name (`customer-id-widget`) muss mit `customElements.define(...)`
in der JS-Datei übereinstimmen (ist er).

## Konfiguration in customer-id-widget.js (Block CONFIG oben)
- `baseUrlByDataCenter` / `fallbackBaseUrl` – eu1 ist gesetzt/bestätigt.
- `workspaceId` – aus deinem GET (`682f3b007542bf078915f230`).
- `paths.getPerson` – **bestätigt** (GET).
- `paths.addIdentities` – **bestätigt** (PATCH, Body `{"customerId":[...]}`).
- `paths.removeIdentities` – **BITTE IM POSTMAN VERIFIZIEREN** (Name/Signatur;
  liegt vermutlich als Sibling neben `add-identities`). Bei abweichendem
  Namen hier + ggf. `methods.removeIdentities` anpassen.

## Bekannte Grenzen (bewusst offen gelassen)
- **Person-ID:** Das Widget lädt aktuell per eingegebener Person-ID. Zum
  Auto-Laden anhand des aktuellen Anrufers braucht es zusätzlich einen
  „Search-by-Alias → personId"-Endpunkt; die Stelle dafür ist im Code
  markiert (`_prefillFromInteraction`).
- **remove-Endpunkt:** siehe oben – vor Produktivnutzung verifizieren.
- **Token-Scope:** Es wird der Desktop-Bearer-Token genutzt. Falls die
  Alias-Änderung einen anderen Scope verlangt, im Tenant prüfen.
