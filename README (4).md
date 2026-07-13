# Customer ID Widget (CJDS Zusatz-Widget)

Zusatz-Widget für den Webex Contact Center Agent Desktop.

**Ablauf beim eingehenden Anruf**
1. ANI (Rufnummer des Anrufers) wird aus `interactionData`
   (`callAssociatedData.ani.value`) gelesen.
2. Person wird per Alias (ANI) geholt: `GET .../person/.../aliases/{ani}`.
3. Name (read-only) und `customerId` (editierbar) werden angezeigt.
4. Ändert der Agent die `customerId`: alter Wert wird entfernt, neuer
   hinzugefügt (übrige Aliase bleiben unberührt).

Kein Backend/Middleware – Web-Component im Browser des Desktops.

## Was liegt wo im GitHub
```
<repo>/
├─ docs/
│  └─ customer-id-widget.js     ← wird über GitHub Pages ausgeliefert
└─ README.md
```
1. Datei nach `docs/customer-id-widget.js` committen.
2. Repo → **Settings → Pages** → Source: Branch `main`, Ordner `/docs`.
3. URL: `https://<USER>.github.io/<REPO>/customer-id-widget.js`
   (nicht `raw.githubusercontent.com`).

### CSP Allowed List (Control Hub → Security Settings)
- Script-Host: `<USER>.github.io`
- API-Host (fetch): `api.wxcc-eu1.cisco.com`

## Desktop-Layout
Das mitgelieferte Layout enthält bereits den **„Customer ID"-Tab** im
Interaktions-Panel (agent/supervisor/supervisorAgent) inkl.
`interactionData`-Property. Vor dem Upload in Control Hub nur die Script-URL
ersetzen:
```
"script": "https://<USER>.github.io/<REPO>/customer-id-widget.js"
```

## Endpunkte (alle bestätigt)
- Person per Alias: `GET /admin/v1/api/person/workspace-id/{ws}/aliases/{ani}`
- Hinzufügen: `PATCH /admin/v1/api/person/add-identities/workspace-id/{ws}/person-id/{pid}`  Body `{"customerId":[...]}`
- Entfernen: `PATCH /admin/v1/api/person/remove-identities/workspace-id/{ws}/person-id/{pid}`  Body `{"customerId":[...]}`

## Konfiguration (Block CONFIG oben in der JS)
- `fallbackBaseUrl` / `baseUrlByDataCenter` – eu1 gesetzt.
- `workspaceId` – aus deinem GET (`682f3b007542bf078915f230`).
- `methods` – Add/Remove als PATCH; bei Abweichung anpassen.

## Hinweise
- ANI-Auto-Load: bei aktiver Sensitive-Data-Protection sind ANIs im Desktop
  maskiert – dann greift das Auto-Laden nicht; der Agent kann die Nummer
  manuell eingeben.
- Ist der Alias in CJDS nicht vorhanden, meldet das Widget „keine Person
  gefunden" – dann existiert für die Nummer noch kein Profil.
- Token-Scope: es wird der Desktop-Bearer-Token genutzt; falls die
  Alias-Änderung einen anderen Scope verlangt, im Tenant prüfen.
