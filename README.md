# Stazione Meteo Montenero

Dashboard meteo con frontend statico, pipeline Python di ingestione e backend HTTP leggero per richiedere refresh live on-demand.

## Panoramica

Il progetto puo funzionare in due modalita diverse:

1. Modalita statica
- il frontend legge solo i file in `data/`
- e la modalita usata da GitHub Pages
- i dati si aggiornano solo quando la pipeline rigenera gli artefatti

2. Modalita live
- il frontend trova un backend HTTP raggiungibile dal browser
- il pulsante `Ricarica` chiede davvero nuovi dati alla sorgente meteo
- il backend esegue la pipeline, rigenera `data/` e il frontend rilegge subito lo snapshot aggiornato

## Architettura

Componenti principali:

- [`update_data.py`](/Users/fra/Documents/code/personal/meteopuzzo/update_data.py)
  Scarica il CSV MeteoProject, prova il trigger archivio, valida il payload, normalizza i dati e pubblica gli artefatti statici.

- [`backend_server.py`](/Users/fra/Documents/code/personal/meteopuzzo/backend_server.py)
  Serve il frontend e gli endpoint HTTP per refresh live e stato backend.

- [`meteopuzzo_backend.py`](/Users/fra/Documents/code/personal/meteopuzzo/meteopuzzo_backend.py)
  Incapsula lo stato del backend, il lock di concorrenza e il refresh live che riusa `update_data.py`.

- [`index.html`](/Users/fra/Documents/code/personal/meteopuzzo/index.html)
  Frontend principale.

- [`script.js`](/Users/fra/Documents/code/personal/meteopuzzo/script.js)
  UI, grafici, monitor di refresh e integrazione col backend live.

- [`style.css`](/Users/fra/Documents/code/personal/meteopuzzo/style.css)
  Stili della dashboard e della nuova UX del refresh live.

- [`config.js`](/Users/fra/Documents/code/personal/meteopuzzo/config.js)
  Configurazione runtime del frontend per usare backend same-origin o backend esterno.

Artefatti pubblicati:

- `data/latest.csv`
- `data/series.json`
- `data/status.json`

## Cosa Succede Quando Premi Ricarica

### Se stai usando il backend live

Il pulsante:

1. chiama `POST /api/refresh`
2. il backend esegue davvero la pipeline meteo
3. la pipeline prova a richiedere nuovi dati alla sorgente
4. il backend rigenera `data/status.json` e `data/series.json`
5. il frontend rilegge subito lo snapshot aggiornato
6. la UI mostra progress, step, esito e differenza tra `nuovo dato`, `fonte invariata` o `errore`

### Se stai usando solo file statici

Il frontend non puo fare refresh live reale. In questo caso:

- GitHub Pages continua a mostrare gli snapshot gia pubblicati
- il backend non esiste oppure non e raggiungibile
- il pulsante non simula piu un refresh live inesistente

## GitHub Pages: Limite Importante

GitHub Pages da sola non puo eseguire codice Python on-demand.

Questo significa che su GitHub Pages pura:

- il sito puo mostrare il frontend
- il sito puo leggere file statici gia pubblicati
- il sito non puo eseguire `update_data.py` quando l utente preme `Ricarica`

Quindi, se vuoi il refresh live vero in produzione, devi affiancare a GitHub Pages un backend separato.

## Configurazione Frontend

Il frontend legge [`config.js`](/Users/fra/Documents/code/personal/meteopuzzo/config.js):

```js
window.METEOPUZZO_CONFIG = {
    apiBaseUrl: '',
    liveRefreshEnabled: true,
};
```

Significato:

- `apiBaseUrl: ''`
  Usa backend same-origin. E utile in locale quando servi tutto da `backend_server.py`.

- `apiBaseUrl: 'https://tuo-backend.example.com'`
  Usa un backend esterno. E il caso tipico se il frontend resta su GitHub Pages ma il backend gira altrove.

- `liveRefreshEnabled: true`
  Abilita la ricerca del backend live.

- `liveRefreshEnabled: false`
  Disattiva completamente la funzione live e lascia il sito in modalita solo snapshot.

## API Backend

Endpoint esposti da [`backend_server.py`](/Users/fra/Documents/code/personal/meteopuzzo/backend_server.py):

- `GET /api/dashboard`
  Restituisce snapshot corrente, stato live backend e payload utili al frontend.

- `GET /api/health`
  Restituisce solo lo stato live backend e metadati dello snapshot.

- `GET /api/refresh-status`
  Alias di health, utile per leggere stato e progress del backend.

- `POST /api/refresh`
  Esegue davvero il refresh live, rigenera gli artefatti e restituisce risultato + progress.

Note operative:

- il backend usa un lock per evitare refresh concorrenti
- se un refresh e gia in corso, l endpoint non avvia un secondo job parallelo
- il backend espone anche CORS tramite `METEOPUZZO_ALLOW_ORIGIN`

## Sviluppo Locale

1. Installa le dipendenze:

```bash
python3 -m pip install -r requirements.txt
```

2. Genera uno snapshot locale iniziale:

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

5. Avvia il backend HTTP locale:

```bash
python3 backend_server.py
```

6. Apri:

```text
http://127.0.0.1:8000
```

In questa modalita:

- il frontend e servito dal backend
- `config.js` puo lasciare `apiBaseUrl: ''`
- il pulsante `Ricarica` richiede davvero nuovi dati

Se vuoi servire solo i file statici:

```bash
python3 -m http.server 8000
```

Ma in quel caso:

- non esistono API live
- il pulsante non puo fare un refresh reale della sorgente

## Deploy Attuale su GitHub

Il repository usa GitHub Actions per pubblicare gli snapshot statici.

### CI

- gira su `push` e `pull_request`
- compila gli script Python
- esegue i test `pytest`
- controlla la sintassi di `script.js`
- valida gli artefatti in `data/`

### Deploy Pages

- gira su `push` a `main`, `workflow_dispatch` e schedule ogni 15 minuti
- esegue sempre `python update_data.py` prima di costruire l artifact Pages
- costruisce un artifact statico con `index.html`, `index.htm`, `config.js`, `style.css`, `script.js` e `data/`
- pubblica su GitHub Pages

## Come Avere Refresh Live Anche in Produzione

Per avere il bottone funzionante anche fuori dal locale, ti serve questa architettura:

1. GitHub Pages per il frontend
- continua a servire HTML, CSS, JS e snapshot statici

2. Backend Python separato
- gira su un tuo server sempre acceso
- espone `GET /api/dashboard`, `GET /api/health`, `GET /api/refresh-status` e `POST /api/refresh`
- puo eseguire `update_data.py`

3. `config.js` puntato al backend

Esempio:

```js
window.METEOPUZZO_CONFIG = {
    apiBaseUrl: 'https://meteopuzzo-backend.example.com',
    liveRefreshEnabled: true,
};
```

In questo scenario:

- il frontend puo restare su GitHub Pages
- quando l utente preme `Ricarica`, il browser chiama il backend esterno
- il backend aggiorna davvero i dati
- il frontend rilegge il nuovo snapshot

## Dove Hostare il Backend in Futuro

Il backend e un server Python semplice, quindi in futuro puoi ospitarlo su:

- un VPS tuo
- Render
- Railway
- Fly.io
- un container Docker su una macchina tua o cloud

Requisiti minimi:

- Python 3.9+
- accesso in rete alla sorgente MeteoProject
- filesystem scrivibile per `data/`
- processo sempre acceso

## Cose da Ricordare Quando Lo Pubblicherai

Quando ospiterai il backend:

1. pubblica anche [`backend_server.py`](/Users/fra/Documents/code/personal/meteopuzzo/backend_server.py) e [`meteopuzzo_backend.py`](/Users/fra/Documents/code/personal/meteopuzzo/meteopuzzo_backend.py)
2. assicurati che il backend possa scrivere in `data/`
3. imposta `config.js` con l URL pubblico del backend
4. se frontend e backend hanno domini diversi, configura `METEOPUZZO_ALLOW_ORIGIN`
5. verifica che `POST /api/refresh` sia raggiungibile dal browser

Esempio CORS permissivo:

```bash
METEOPUZZO_ALLOW_ORIGIN=https://tuo-frontend.github.io python3 backend_server.py
```

## Cosa Fare Subito su GitHub

1. Fai push di questa versione su `main`
2. In `Settings -> Pages`, imposta `Source` su `GitHub Actions`
3. Verifica che le Actions siano abilitate
4. Approva l ambiente `github-pages` se GitHub lo richiede
5. Quando in futuro avrai il backend, aggiorna `config.js` con il suo URL pubblico

## Note Operative

- Se MeteoProject non risponde o restituisce un CSV malformato, il deploy statico fallisce e GitHub Pages continua a servire l ultima versione valida.
- Se MeteoProject risponde ma non ha ancora pubblicato un dato piu recente, la pipeline pubblica comunque gli artefatti marcandoli come `stale` in `data/status.json`.
- Il backend live e disponibile in locale o su un tuo server Python: GitHub Pages resta statica finche non configuri un backend esterno raggiungibile dal browser.
- [`Update Data.py`](/Users/fra/Documents/code/personal/meteopuzzo/Update%20Data.py) resta come wrapper compatibile, ma l entrypoint vero e supportato e `update_data.py`.
