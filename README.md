# Stazione Meteo Montenero

Dashboard meteo statico pubblicato su GitHub Pages e aggiornato da GitHub Actions.

## Come Funziona

- Sorgente dati: CSV pubblico di MeteoProject per la stazione Montenero.
- Pipeline: [`update_data.py`](/Users/fra/Documents/code/personal/meteopuzzo/update_data.py) scarica il CSV, prova il trigger archivio, valida schema e freshness, rimuove il footer, normalizza i campi e pubblica artefatti statici.
- Artefatti pubblicati:
  - `data/latest.csv`
  - `data/series.json`
  - `data/status.json`
- Dipendenze frontend runtime: `Chart.js` e vendorizzato localmente in `vendor/chart.umd.min.js`.
- Frontend: [`index.html`](/Users/fra/Documents/code/personal/meteopuzzo/index.html) legge solo JSON pulito e segnala loading, errore e dato stale.
- Deploy: il workflow Pages pubblica il sito senza fare commit periodici su `main`.

## Workflows

- `CI`
  - gira su `push` e `pull_request`
  - compila gli script Python
  - esegue i test `pytest`
  - controlla la sintassi di `script.js`
  - valida gli artefatti in `data/`
- `Deploy Pages`
  - gira su `push` a `main`, `workflow_dispatch` e schedule ogni 15 minuti
  - esegue sempre `python update_data.py` prima di costruire l'artifact Pages
  - costruisce un artifact statico con `index.html`, `index.htm`, `style.css`, `script.js` e `data/`
  - pubblica su GitHub Pages

## Sviluppo Locale

1. Installa le dipendenze:
   ```bash
   python3 -m pip install -r requirements.txt
   ```
2. Aggiorna i dati locali:
   ```bash
   python3 update_data.py
   ```
3. Esegui i test:
   ```bash
   python3 -m pytest
   ```
4. Controlla la sintassi frontend:
   ```bash
   node --check script.js
   ```
5. Avvia un server statico locale:
   ```bash
   python3 -m http.server 8000
   ```
   Poi apri `http://localhost:8000`.

## Cosa Devi Fare Su GitHub

1. Fare push di questa versione su `main`.
2. In `Settings -> Pages`, impostare `Source` su `GitHub Actions`.
3. In `Settings -> Actions -> General`, verificare che le Actions siano abilitate.
4. In `Settings -> Actions -> General -> Workflow permissions`, lasciare il `GITHUB_TOKEN` con i permessi standard richiesti dai workflow.
5. Avviare una volta `Deploy Pages` da `Actions`, oppure fare un push su `main`.
6. Se GitHub chiede approvazione dell’ambiente `github-pages`, approvarla.

## Note Operative

- Se MeteoProject non risponde o restituisce un CSV malformato, il deploy fallisce e GitHub Pages continua a servire l’ultima versione valida.
- Se MeteoProject risponde ma non ha ancora pubblicato un dato piu recente, la pipeline pubblica comunque gli artefatti marcandoli come `stale` in `data/status.json`.
- [`Update Data.py`](/Users/fra/Documents/code/personal/meteopuzzo/Update%20Data.py) resta come wrapper compatibile, ma l’entrypoint vero e supportato e `update_data.py`.
