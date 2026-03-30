# Stazione Meteo Montenero

Dashboard meteo con frontend statico, pipeline Python e refresh live on-demand. Il progetto ora puo essere eseguito in locale come prima, ma puo anche essere pubblicato interamente su Vercel con backend Python serverless e storage persistente su Vercel Blob.

## Panoramica

Il progetto oggi supporta due modalita operative:

1. Modalita locale
- il frontend e servito da [`backend_server.py`](/Users/fra/Documents/code/personal/meteopuzzo/backend_server.py)
- gli snapshot vengono letti e scritti in `data/`
- il pulsante `Ricarica` chiama davvero `POST /api/refresh`

2. Modalita Vercel
- il frontend statico e servito dal deploy Vercel
- le API Python vivono sotto `api/`
- gli snapshot persistono su Vercel Blob, non sul filesystem del deploy
- il pulsante `Ricarica` richiede davvero nuovi dati alla sorgente e il risultato resta disponibile anche dopo reload e nuove invocazioni

## Architettura

Componenti principali:

- [`update_data.py`](/Users/fra/Documents/code/personal/meteopuzzo/update_data.py)
  Scarica il CSV MeteoProject, prova il trigger archivio, valida il payload e genera `latest.csv`, `series.json` e `status.json`.

- [`meteopuzzo_backend.py`](/Users/fra/Documents/code/personal/meteopuzzo/meteopuzzo_backend.py)
  Incapsula il refresh live, il lock locale, lo stato del refresh e il payload API condiviso.

- [`meteopuzzo_storage.py`](/Users/fra/Documents/code/personal/meteopuzzo/meteopuzzo_storage.py)
  Astrazione dello storage. In locale usa `data/`, su Vercel usa Blob.

- [`meteopuzzo_runtime.py`](/Users/fra/Documents/code/personal/meteopuzzo/meteopuzzo_runtime.py)
  Seleziona il backend corretto per locale o runtime Vercel.

- [`backend_server.py`](/Users/fra/Documents/code/personal/meteopuzzo/backend_server.py)
  Server HTTP locale per sviluppo e debug.

- [`api/dashboard.py`](/Users/fra/Documents/code/personal/meteopuzzo/api/dashboard.py)
- [`api/refresh.py`](/Users/fra/Documents/code/personal/meteopuzzo/api/refresh.py)
- [`api/health.py`](/Users/fra/Documents/code/personal/meteopuzzo/api/health.py)
- [`api/refresh_status.py`](/Users/fra/Documents/code/personal/meteopuzzo/api/refresh_status.py)
- [`api/cron_refresh.py`](/Users/fra/Documents/code/personal/meteopuzzo/api/cron_refresh.py)
  Functions Python usate da Vercel.

- [`script.js`](/Users/fra/Documents/code/personal/meteopuzzo/script.js)
  Frontend della dashboard. Quando trova un backend live legge `GET /api/dashboard`; se non c e, ripiega su `data/*.json`.

- [`vercel.json`](/Users/fra/Documents/code/personal/meteopuzzo/vercel.json)
  Configurazione Vercel: durata massima delle Functions, rewrite degli endpoint e cron ogni 15 minuti.

## Come Funziona Ricarica

Quando premi `Ricarica`:

1. il frontend chiama `POST /api/refresh`
2. il backend contatta MeteoProject e scarica il CSV piu recente
3. la pipeline rigenera `latest.csv`, `series.json` e `status.json`
4. in locale quei file finiscono in `data/`
5. su Vercel gli stessi artefatti vengono pubblicati su Blob
6. il frontend rilegge `GET /api/dashboard`
7. la UI mostra progress, esito e differenza tra `nuovo dato`, `fonte invariata` o `errore`

## Storage

In locale:

- storage filesystem
- directory usata: `data/`

Su Vercel:

- storage Vercel Blob
- gli snapshot non vengono affidati al filesystem del deploy
- il prefisso Blob di default e `meteopuzzo/<VERCEL_ENV>`
- puoi sovrascriverlo con `METEOPUZZO_BLOB_PREFIX`

Questo e importante perche le Vercel Functions non vanno trattate come un server persistente con cartelle locali condivise tra invocazioni.

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
  Usa backend same-origin. Su Vercel e la scelta consigliata.

- `apiBaseUrl: 'https://tuo-backend.example.com'`
  Usa un backend esterno. Serve solo se il frontend vive altrove.

- `liveRefreshEnabled: true`
  Abilita la ricerca del backend live.

- `liveRefreshEnabled: false`
  Forza la modalita solo snapshot.

## API Disponibili

Endpoint principali:

- `GET /api/dashboard`
  Restituisce snapshot corrente, stato backend e payload completo per il frontend.

- `GET /api/health`
  Restituisce stato backend e metadati dello snapshot.

- `GET /api/refresh-status`
  Alias di `health`.

- `POST /api/refresh`
  Richiede davvero nuovi dati alla sorgente.

- `GET /api/cron-refresh`
  Endpoint pensato per il cron di Vercel.

## Sviluppo Locale

1. Installa le dipendenze:

```bash
python3 -m pip install -r requirements.txt
```

2. Genera uno snapshot iniziale:

```bash
python3 update_data.py
```

3. Avvia il server locale:

```bash
python3 backend_server.py
```

4. Apri:

```text
http://127.0.0.1:8000
```

Verifiche utili:

```bash
python3 -m pytest
node --check script.js
python3 -m py_compile update_data.py backend_server.py meteopuzzo_backend.py meteopuzzo_storage.py meteopuzzo_runtime.py vercel_api_common.py
```

## Deploy Completo su Vercel

### Obiettivo

Pubblicare:

- frontend statico
- API Python same-origin
- refresh live manuale
- refresh schedulato ogni 15 minuti
- persistenza snapshot su Vercel Blob

### Passi

1. Importa il repository in Vercel.
2. Crea uno store Blob dal pannello Storage e collegalo al progetto.
3. Verifica che Vercel abbia aggiunto `BLOB_READ_WRITE_TOKEN` agli environment variables del progetto.
4. Fai deploy del progetto.
5. Controlla che `GET /api/dashboard` risponda.
6. Premi `Ricarica` dal frontend e verifica che il backend completi il refresh.

### Variabili d ambiente consigliate

Obbligatorie in produzione:

- `BLOB_READ_WRITE_TOKEN`
  Viene normalmente aggiunta automaticamente quando colleghi Blob al progetto.

Consigliate:

- `CRON_SECRET`
  Protegge l endpoint del cron.

- `METEOPUZZO_STORAGE=blob`
  Forza esplicitamente la modalita Blob anche se il token fosse assente in ambienti particolari.

- `METEOPUZZO_BLOB_PREFIX=meteopuzzo/production`
  Utile se vuoi controllare manualmente il namespace Blob.

- `METEOPUZZO_ALLOW_ORIGIN`
  Serve solo se frontend e backend sono su domini diversi.

Configurazione meteo opzionale:

- `METEOPUZZO_STATION_SLUG`
- `METEOPUZZO_STATION_NAME`
- `METEOPUZZO_TIMEZONE`
- `METEOPUZZO_LOOKBACK_DAYS`
- `METEOPUZZO_MAX_STALE_MINUTES`
- `METEOPUZZO_EXPECTED_CADENCE_MINUTES`
- `METEOPUZZO_REQUEST_TIMEOUT_SECONDS`
- `METEOPUZZO_RETRIES`
- `METEOPUZZO_RETRY_DELAY_SECONDS`
- `METEOPUZZO_TRIGGER_ARCHIVE_REFRESH`

### Cron Vercel

Il progetto include gia un cron in [`vercel.json`](/Users/fra/Documents/code/personal/meteopuzzo/vercel.json):

```json
{
  "path": "/api/cron-refresh",
  "schedule": "*/15 * * * *"
}
```

Quindi, una volta deployato su production:

- Vercel invochera periodicamente l endpoint
- l endpoint eseguira la pipeline
- lo snapshot restera salvato su Blob
- il frontend trovera sempre l ultimo snapshot persistito

Se imposti `CRON_SECRET`, il cron verra accettato solo con l header `Authorization: Bearer <CRON_SECRET>`.

## Comportamento del Frontend su Vercel

Su Vercel il frontend:

- prova prima `GET /api/dashboard`
- se l API risponde, usa quello snapshot come sorgente principale
- se l API non e disponibile, puo ancora ripiegare sui file statici `data/`

Questo fallback e utile nei primi deploy o durante il bootstrap, ma la sorgente corretta in produzione Vercel e l API, non il `data/` statico incluso nel bundle.

## GitHub Pages

GitHub Pages resta possibile solo come variante statica o come frontend separato con backend esterno.

Se in futuro vuoi usare ancora GitHub Pages:

- lascia `config.js` con `apiBaseUrl` puntato a un backend pubblico
- abilita CORS con `METEOPUZZO_ALLOW_ORIGIN`

Ma se vuoi tenere tutto nello stesso hosting con refresh live vero, Vercel e ora la strada consigliata.

## Note Operative

- [`Update Data.py`](/Users/fra/Documents/code/personal/meteopuzzo/Update%20Data.py) resta come wrapper compatibile, ma l entrypoint supportato e [`update_data.py`](/Users/fra/Documents/code/personal/meteopuzzo/update_data.py).
- Il server locale [`backend_server.py`](/Users/fra/Documents/code/personal/meteopuzzo/backend_server.py) resta utile per sviluppo e debug anche dopo il passaggio a Vercel.
- Il lock di refresh protegge i doppio-click e le richieste concorrenti nello stesso processo. Su Vercel il deployment e serverless, quindi la protezione e best-effort per singola istanza.
- Se MeteoProject non pubblica un dato piu recente, il refresh puo completarsi con snapshot aggiornato ma `sourceUpdatedAt` invariato.
