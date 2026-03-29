const SERIES_URL = 'data/series.json';
const STATUS_URL = 'data/status.json';
const DASHBOARD_API_URL = 'api/dashboard';
const LIVE_REFRESH_API_URL = 'api/refresh';
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12000;
const REFRESH_STAGE_ADVANCE_MS = 1100;
const STALE_THRESHOLD_MINUTES = 90;
const LIVE_REFRESH_TIMEOUT_MS = 60000;
const STORAGE_KEY = 'meteopuzzo.selectedMetric';
const RANGE_STORAGE_KEY = 'meteopuzzo.selectedRange';
const COMPASS_DIRECTIONS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const COMPASS_DIRECTIONS_IT = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
const COMPASS_DIRECTIONS_FULL_IT = ['NORD', 'NORD-NORD-EST', 'NORD-EST', 'EST-NORD-EST', 'EST', 'EST-SUD-EST', 'SUD-EST', 'SUD-SUD-EST', 'SUD', 'SUD-SUD-OVEST', 'SUD-OVEST', 'OVEST-SUD-OVEST', 'OVEST', 'OVEST-NORD-OVEST', 'NORD-OVEST', 'NORD-NORD-OVEST'];
const DIRECTION_STEP_DEGREES = 22.5;
const APP_CONFIG = resolveAppConfig();
const API_BASE_URL = normalizeApiBaseUrl(APP_CONFIG.apiBaseUrl);

const METRICS = {
    temperature: {
        label: 'Temperatura',
        unit: 'C',
        axisLabel: 'Temperatura (C)',
        color: '#ec7b57',
        companion: 'dewPoint',
        tone: 'warm',
    },
    humidity: {
        label: 'Umidita',
        unit: '%',
        axisLabel: 'Umidita (%)',
        color: '#1f9f78',
        tone: 'green',
    },
    pressure: {
        label: 'Pressione',
        unit: 'hPa',
        axisLabel: 'Pressione (hPa)',
        color: '#1c8dd8',
        tone: 'blue',
    },
    wind: {
        label: 'Vento',
        unit: 'km/h',
        axisLabel: 'Vento (km/h)',
        color: '#c78a19',
        companion: 'gust',
        tone: 'gold',
    },
    rain: {
        label: 'Pioggia',
        unit: 'mm',
        axisLabel: 'Pioggia (mm)',
        color: '#4f7bf5',
        tone: 'blue',
    },
    gust: {
        label: 'Raffica',
        unit: 'km/h',
        axisLabel: 'Raffica (km/h)',
        color: '#d38b18',
        tone: 'gold',
    },
    dewPoint: {
        label: 'Dew point',
        unit: 'C',
        axisLabel: 'Dew point (C)',
        color: '#e9a089',
        tone: 'warm',
    },
    direction: {
        label: 'Direzione',
        unit: '',
        axisLabel: 'Direzione del vento',
        color: '#1c8dd8',
        tone: 'blue',
    },
};

const METRIC_ORDER = ['temperature', 'humidity', 'pressure', 'wind', 'rain'];
const RANGE_OPTIONS = {
    '1h': { label: '1h', minutes: 60 },
    '6h': { label: '6h', minutes: 6 * 60 },
    '12h': { label: '12h', minutes: 12 * 60 },
    '24h': { label: '24h', minutes: 24 * 60 },
};
const RANGE_ORDER = ['1h', '6h', '12h', '24h'];

const FIELD_ALIASES = {
    timestamp: ['timestamp', 'datetime', 'dateTime', 'dataora', 'datetimeiso', 'iso', 'date_time', 'observedAt', 'time', 'ts'],
    date: ['date', 'data', 'day'],
    clock: ['time', 'ora', 'hour'],
    temperature: ['temperature', 'temp', 'temperatura', 'temperatureC', 'tempC'],
    dewPoint: ['dewPoint', 'dewpt', 'dew_pt', 'dew pt', 'dew', 'puntoRugiada', 'dewPointC'],
    humidity: ['humidity', 'hum', 'umid', 'umidita', 'umidita', 'humidityPct'],
    pressure: ['pressure', 'press', 'pressione', 'pressureHpa'],
    wind: ['wind', 'vento', 'windKmh'],
    gust: ['gust', 'raffica', 'gustKmh'],
    rain: ['rain', 'pioggia', 'precipitation', 'precip', 'precipitationMm'],
    direction: ['direction', 'dir', 'direzione', 'windDirection'],
    rowCount: ['rowCount', 'rows', 'count', 'observationCount'],
    status: ['status', 'state', 'health'],
    message: ['message', 'detail', 'info'],
    stale: ['stale', 'isStale'],
    sourceUpdatedAt: ['sourceUpdatedAt', 'latestObservationAt', 'lastObservationAt', 'lastSourceTimestamp', 'observedAt'],
    publishedAt: ['publishedAt', 'lastUpdatedAt', 'updatedAt', 'lastPublishAt', 'lastSuccessfulPublish', 'generatedAt'],
    observationAgeMinutes: ['observationAgeMinutes', 'ageMinutes'],
    expectedCadenceMinutes: ['expectedCadenceMinutes', 'cadenceMinutes'],
};

function resolveAppConfig() {
    const rawConfig = window.METEOPUZZO_CONFIG && typeof window.METEOPUZZO_CONFIG === 'object'
        ? window.METEOPUZZO_CONFIG
        : {};

    return {
        apiBaseUrl: typeof rawConfig.apiBaseUrl === 'string' ? rawConfig.apiBaseUrl : '',
        liveRefreshEnabled: rawConfig.liveRefreshEnabled !== false,
    };
}

function normalizeApiBaseUrl(value) {
    const normalized = String(value || '').trim();
    if (!normalized) {
        return '';
    }

    return normalized.replace(/\/+$/, '');
}

const state = {
    chart: null,
    records: [],
    status: null,
    selectedMetric: window.localStorage.getItem(STORAGE_KEY) || 'temperature',
    selectedRange: window.localStorage.getItem(RANGE_STORAGE_KEY) || getDefaultRange(),
    loading: false,
    requestController: null,
    requestId: 0,
    availableMetrics: new Set(),
    liveRefresh: {
        supported: null,
        running: false,
        animationTimer: null,
        phase: 'probing',
        step: 'idle',
        message: 'Sto verificando se questo deploy espone un backend live.',
        detail: 'Il pulsante si attiva solo quando trova un endpoint capace di richiedere nuovi dati alla sorgente.',
        actionLabel: 'Verifica backend live',
        actionMeta: 'Controllo della disponibilita del backend live in corso.',
        modeLabel: 'Verifica',
        modeTone: 'probing',
        progress: 8,
        completedAt: null,
        error: null,
    },
    refreshMonitor: {
        tone: 'idle',
        badgeLabel: 'In attesa',
        title: 'Sto preparando il primo controllo dei dati pubblicati.',
        body: 'Quando ricarichi, qui ti mostro se il sito ha pubblicato un nuovo file e se la fonte principale contiene un nuovo dato.',
        checkedAt: null,
    },
};

const elements = {};

document.addEventListener('DOMContentLoaded', init);

async function init() {
    cacheElements();
    bindActions();
    applyChartDefaults();
    renderSummarySkeleton();
    renderHeroEmpty();
    renderLiveRefreshState();
    await detectLiveRefreshSupport();
    await loadDashboard({ initial: true });
    window.setInterval(() => {
        loadDashboard({ silent: true });
    }, REFRESH_INTERVAL_MS);
}

function cacheElements() {
    elements.connectionPill = document.getElementById('connectionPill');
    elements.freshnessSummary = document.getElementById('freshnessSummary');
    elements.lastUpdate = document.getElementById('lastUpdate');
    elements.refreshNow = document.getElementById('refreshNow');
    elements.refreshConsole = document.getElementById('refreshConsole');
    elements.refreshActionSummary = document.getElementById('refreshActionSummary');
    elements.refreshActionMeta = document.getElementById('refreshActionMeta');
    elements.refreshModePill = document.getElementById('refreshModePill');
    elements.refreshButtonLabel = document.getElementById('refreshButtonLabel');
    elements.refreshProgressFill = document.getElementById('refreshProgressFill');
    elements.refreshStepSource = document.getElementById('refreshStepSource');
    elements.refreshStepPublish = document.getElementById('refreshStepPublish');
    elements.refreshStepSync = document.getElementById('refreshStepSync');
    elements.refreshMonitor = document.getElementById('refreshMonitor');
    elements.refreshMonitorBadge = document.getElementById('refreshMonitorBadge');
    elements.refreshMonitorTitle = document.getElementById('refreshMonitorTitle');
    elements.refreshMonitorBody = document.getElementById('refreshMonitorBody');
    elements.refreshCheckedAt = document.getElementById('refreshCheckedAt');
    elements.refreshPublishedAt = document.getElementById('refreshPublishedAt');
    elements.refreshSourceAt = document.getElementById('refreshSourceAt');
    elements.statusDetails = document.getElementById('statusDetails');
    elements.statusDetailsSummary = document.getElementById('statusDetailsSummary');
    elements.statusDetailsList = document.getElementById('statusDetailsList');
    elements.heroTemperature = document.getElementById('heroTemperature');
    elements.heroWind = document.getElementById('heroWind');
    elements.heroDirection = document.getElementById('heroDirection');
    elements.heroHumidity = document.getElementById('heroHumidity');
    elements.heroPressure = document.getElementById('heroPressure');
    elements.heroNarrative = document.getElementById('heroNarrative');
    elements.summaryPrimary = document.getElementById('summaryPrimary');
    elements.summarySecondary = document.getElementById('summarySecondary');
    elements.summaryMeta = document.getElementById('summaryMeta');
    elements.chartTitle = document.getElementById('chartTitle');
    elements.chartSubtitle = document.getElementById('chartSubtitle');
    elements.chartEmptyState = document.getElementById('chartEmptyState');
    elements.statusBanner = document.getElementById('statusBanner');
    elements.metricButtons = Array.from(document.querySelectorAll('.metric-button'));
    elements.rangeButtons = Array.from(document.querySelectorAll('.range-button'));
    elements.canvas = document.getElementById('myChart');
    elements.chartPanel = document.getElementById('trendPanel');
    elements.currentCard = document.getElementById('currentCard');
}

function bindActions() {
    elements.refreshNow?.addEventListener('click', () => {
        handleManualRefresh();
    });

    elements.metricButtons.forEach((button) => {
        button.addEventListener('click', () => {
            selectMetric(button.dataset.metric);
        });
    });

    elements.rangeButtons.forEach((button) => {
        button.addEventListener('click', () => {
            selectRange(button.dataset.range);
        });
    });

    bindArrowKeyNavigation('.metric-switcher', '.metric-button');
    bindArrowKeyNavigation('.range-switcher', '.range-button');
}

function bindArrowKeyNavigation(containerSelector, buttonSelector) {
    const container = document.querySelector(containerSelector);
    if (!container) {
        return;
    }

    container.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
            return;
        }

        const buttons = Array.from(container.querySelectorAll(buttonSelector)).filter((button) => !button.disabled);
        if (!buttons.length) {
            return;
        }

        const currentIndex = buttons.indexOf(document.activeElement);
        let nextIndex = currentIndex >= 0 ? currentIndex : 0;

        if (event.key === 'Home') {
            nextIndex = 0;
        } else if (event.key === 'End') {
            nextIndex = buttons.length - 1;
        } else {
            const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
            nextIndex = currentIndex >= 0 ? (currentIndex + direction + buttons.length) % buttons.length : 0;
        }

        buttons[nextIndex].focus();
        event.preventDefault();
    });
}

async function handleManualRefresh() {
    if (state.liveRefresh.running) {
        return;
    }

    if (!state.liveRefresh.supported) {
        setLiveRefreshState({
            phase: 'error',
            step: 'unsupported',
            message: 'Questo deploy non espone un backend live raggiungibile dal browser.',
            detail: API_BASE_URL
                ? `Verifica che l endpoint ${API_BASE_URL}/api/dashboard risponda correttamente e consenta CORS.`
                : 'Avvia `python3 backend_server.py` in locale oppure imposta `apiBaseUrl` in `config.js` per usare un backend esterno.',
            actionLabel: 'Backend live assente',
            actionMeta: 'Il pulsante resta disabilitato finche non e presente un endpoint `/api/refresh` utilizzabile.',
            modeLabel: 'Offline',
            modeTone: 'error',
            progress: 0,
            error: 'Backend live non disponibile',
        });
        return;
    }

    await requestLiveRefresh();
}

async function detectLiveRefreshSupport() {
    if (!APP_CONFIG.liveRefreshEnabled) {
        setLiveRefreshState({
            supported: false,
            phase: 'snapshot',
            step: 'disabled',
            message: 'Refresh live disattivato dalla configurazione frontend.',
            detail: 'Imposta `liveRefreshEnabled: true` in `config.js` per abilitare l integrazione col backend.',
            actionLabel: 'Refresh live disattivato',
            actionMeta: 'La dashboard continuera a leggere solo gli snapshot pubblicati.',
            modeLabel: 'Snapshot',
            modeTone: 'snapshot',
            progress: 0,
        });
        return;
    }

    try {
        const payload = await fetchApiJson(`/${DASHBOARD_API_URL}`);
        updateLiveRefreshFromApi(payload, { initialProbe: true });
    } catch (error) {
        if (error?.payload?.backend?.capabilities?.supportsLiveRefresh) {
            updateLiveRefreshFromApi(error.payload, { initialProbe: true });
            return;
        }

        setLiveRefreshState({
            supported: false,
            phase: 'snapshot',
            step: 'unsupported',
            message: 'Backend live non raggiungibile da questo deploy.',
            detail: API_BASE_URL
                ? `Il frontend sta cercando il backend su ${API_BASE_URL}, ma la verifica iniziale e fallita.`
                : 'GitHub Pages pura non puo eseguire refresh live: serve un backend separato oppure il server locale `backend_server.py`.',
            actionLabel: 'Refresh live non disponibile',
            actionMeta: 'Il pulsante non simula piu un refresh reale: si abilita solo quando trova un backend capace di aggiornare davvero i dati.',
            modeLabel: 'Snapshot',
            modeTone: 'snapshot',
            progress: 0,
            error: error?.message || 'Backend live non raggiungibile',
        });
    }
}

async function requestLiveRefresh() {
    const previousStatus = state.status;
    setLiveRefreshState({
        running: true,
        phase: 'running',
        step: 'queued',
        message: 'Invio la richiesta al backend live.',
        detail: 'Sto chiedendo al backend di contattare la fonte, rigenerare gli artefatti e poi sincronizzare la dashboard.',
        actionLabel: 'Richiesta in corso',
        actionMeta: 'Refresh live avviato. Puoi seguire le fasi qui sotto in tempo reale.',
        modeLabel: 'Live',
        modeTone: 'running',
        progress: 14,
        error: null,
    });
    startLiveRefreshAnimation();
    setRefreshMonitorLoading({ manual: true, live: true });

    try {
        const payload = await fetchApiJson(`/${LIVE_REFRESH_API_URL}`, {
            method: 'POST',
            timeoutMs: LIVE_REFRESH_TIMEOUT_MS,
        });
        stopLiveRefreshAnimation();
        updateLiveRefreshFromApi(payload);
        await loadDashboard({ force: true, live: true });

        const refreshDelta = compareRefreshStatus(previousStatus, state.status);
        const sourceAdvanced = refreshDelta.sourcePublishedNewData;
        const publishedAdvanced = refreshDelta.sitePublishedNewFile;

        setLiveRefreshState({
            running: false,
            phase: sourceAdvanced ? 'success' : 'snapshot',
            step: 'completed',
            message: sourceAdvanced
                ? 'Nuovi dati ricevuti e pubblicati.'
                : 'Refresh live completato senza un nuovo campione dalla fonte.',
            detail: sourceAdvanced
                ? `Ultimo dato fonte ${formatMonitorTimestamp(state.status?.sourceUpdatedAt)} · pubblicazione ${formatMonitorTimestamp(state.status?.publishedAt)}.`
                : publishedAdvanced
                    ? `Il backend ha rigenerato lo snapshot alle ${formatMonitorTimestamp(state.status?.publishedAt)}, ma la fonte non ha pubblicato un dato piu recente.`
                    : 'La richiesta live e stata eseguita, ma la fonte non ha pubblicato un campione piu recente rispetto all ultimo snapshot.',
            actionLabel: 'Richiedi nuovi dati live',
            actionMeta: 'Il backend live e pronto per una nuova richiesta manuale.',
            modeLabel: sourceAdvanced ? 'Live' : 'Snapshot',
            modeTone: sourceAdvanced ? 'live' : 'snapshot',
            progress: 100,
            completedAt: Date.now(),
            error: null,
        });

        if (sourceAdvanced) {
            pulseRefreshMonitor();
        }
    } catch (error) {
        stopLiveRefreshAnimation();
        setLiveRefreshState({
            running: false,
            phase: 'error',
            step: 'failed',
            message: 'Il backend ha rifiutato o fallito il refresh live.',
            detail: sanitizeText(error?.message || 'Errore sconosciuto'),
            actionLabel: 'Riprova refresh live',
            actionMeta: 'La dashboard continua a mostrare l ultimo snapshot valido.',
            modeLabel: 'Errore',
            modeTone: 'error',
            progress: 0,
            error: error?.message || 'Refresh live fallito',
        });
        setRefreshMonitorFailure(error, { live: true });
    }
}

async function fetchApiJson(path, { method = 'GET', body = null, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    let response;

    try {
        response = await fetch(buildApiUrl(path), {
            method,
            headers: {
                Accept: 'application/json',
                ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            body: body ? JSON.stringify(body) : null,
            cache: 'no-store',
            signal: controller.signal,
        });
    } catch (error) {
        window.clearTimeout(timeoutId);
        if (error?.name === 'AbortError') {
            throw new Error(`Timeout durante la richiesta a ${path}`);
        }
        throw error;
    }

    window.clearTimeout(timeoutId);

    let payload = null;
    try {
        payload = await response.json();
    } catch (error) {
        payload = null;
    }

    if (!response.ok) {
        const message = payload?.refresh?.message
            || payload?.state?.message
            || payload?.error
            || `Request for ${path} failed with status ${response.status}`;
        const error = new Error(message);
        error.statusCode = response.status;
        error.payload = payload;
        throw error;
    }

    return payload;
}

function buildApiUrl(path) {
    return `${API_BASE_URL}${path}`;
}

function updateLiveRefreshFromApi(payload, { initialProbe = false } = {}) {
    const normalized = normalizeLiveRefreshPayload(payload);
    const snapshot = normalized.snapshot;
    const apiState = normalized.state;
    const phase = apiState.phase || 'idle';
    const step = apiState.step || 'idle';
    const supported = normalized.supported;

    const detail = buildLiveRefreshDetail(apiState, snapshot, { initialProbe });
    const message = buildLiveRefreshMessage(apiState, snapshot, { initialProbe });
    const presentation = resolveLiveRefreshPresentation(phase, step, supported);

    setLiveRefreshState({
        supported,
        running: apiState.running === true,
        phase,
        step,
        message,
        detail,
        actionLabel: presentation.actionLabel,
        actionMeta: presentation.actionMeta,
        modeLabel: presentation.modeLabel,
        modeTone: presentation.modeTone,
        progress: presentation.progress,
        error: apiState.error || null,
    });
}

function normalizeLiveRefreshPayload(payload) {
    const backend = payload?.backend || {};
    const capabilities = backend?.capabilities || {};
    const refresh = payload?.refresh || {};
    const progress = Array.isArray(refresh.progress) ? refresh.progress : [];
    const lastProgress = progress[progress.length - 1] || null;
    const refreshState = refresh.state || capabilities.lastRefreshState || 'idle';
    const running = capabilities.refreshInProgress === true;

    return {
        supported: capabilities.supportsLiveRefresh === true,
        snapshot: payload?.snapshot || {
            available: Boolean(payload?.status || payload?.series),
            publishedAt: payload?.status?.publishedAt || null,
            sourceUpdatedAt: payload?.status?.sourceUpdatedAt || null,
            status: payload?.status?.status || null,
            stale: payload?.status?.stale || false,
            message: payload?.status?.message || null,
            observationCount: payload?.status?.rowCount || payload?.series?.observationCount || null,
        },
        state: {
            running,
            phase: normalizeLiveRefreshPhase(refreshState, running),
            step: lastProgress?.step || (refreshState === 'completed' ? 'completed' : 'idle'),
            message: refresh.message || capabilities.lastRefreshMessage || null,
            error: refresh.ok === false ? refresh.message || payload?.error : null,
        },
    };
}

function normalizeLiveRefreshPhase(refreshState, running) {
    if (running) {
        return 'running';
    }

    if (refreshState === 'completed') {
        return 'success';
    }

    if (refreshState === 'failed') {
        return 'error';
    }

    return 'idle';
}

function buildLiveRefreshMessage(apiState, snapshot, { initialProbe = false } = {}) {
    if (initialProbe) {
        return 'Backend live rilevato. Da qui il pulsante puo richiedere davvero nuovi dati meteo.';
    }

    if (apiState.message) {
        return sanitizeText(apiState.message);
    }

    if (snapshot?.available) {
        return 'Snapshot pubblicato disponibile.';
    }

    return 'Backend live pronto.';
}

function buildLiveRefreshDetail(apiState, snapshot, { initialProbe = false } = {}) {
    if (initialProbe) {
        return API_BASE_URL
            ? `Il frontend usera il backend configurato su ${API_BASE_URL} per richiedere nuovi dati alla fonte.`
            : 'Il frontend ha trovato un backend same-origin e usera `POST /api/refresh` per richiedere nuovi dati alla sorgente.';
    }

    if (apiState.phase === 'success' && snapshot?.sourceUpdatedAt) {
        return `Ultimo dato fonte pubblicato: ${formatMonitorTimestamp(parseTimestampValue(snapshot.sourceUpdatedAt))}.`;
    }

    if (apiState.error) {
        return sanitizeText(apiState.error);
    }

    if (snapshot?.publishedAt || snapshot?.sourceUpdatedAt) {
        const published = snapshot.publishedAt
            ? formatMonitorTimestamp(parseTimestampValue(snapshot.publishedAt))
            : 'n/d';
        const source = snapshot.sourceUpdatedAt
            ? formatMonitorTimestamp(parseTimestampValue(snapshot.sourceUpdatedAt))
            : 'n/d';
        return `Snapshot attuale ${published} · ultimo dato fonte ${source}.`;
    }

    return 'Il backend e pronto a richiedere un nuovo snapshot alla sorgente meteo.';
}

function resolveLiveRefreshPresentation(phase, step, supported) {
    if (!supported) {
        return {
            actionLabel: 'Refresh live non disponibile',
            actionMeta: 'Configura o avvia un backend live per abilitare la richiesta reale di nuovi dati.',
            modeLabel: 'Snapshot',
            modeTone: 'snapshot',
            progress: 0,
        };
    }

    if (phase === 'success') {
        return {
            actionLabel: 'Richiedi nuovi dati live',
            actionMeta: 'Il backend live e attivo e pronto a chiedere nuovi dati alla sorgente.',
            modeLabel: 'Live',
            modeTone: 'live',
            progress: 100,
        };
    }

    if (phase === 'error') {
        return {
            actionLabel: 'Riprova refresh live',
            actionMeta: 'L ultima richiesta live e fallita. Il frontend sta mantenendo l ultimo snapshot valido.',
            modeLabel: 'Errore',
            modeTone: 'error',
            progress: 0,
        };
    }

    if (phase === 'cooldown') {
        return {
            actionLabel: 'Attendi cooldown',
            actionMeta: 'Il backend limita le richieste troppo ravvicinate per non martellare la sorgente.',
            modeLabel: 'Cooldown',
            modeTone: 'snapshot',
            progress: 0,
        };
    }

    if (phase === 'running') {
        return {
            actionLabel: 'Aggiornamento live in corso',
            actionMeta: 'Sto seguendo il job backend fino alla pubblicazione e sincronizzazione finale.',
            modeLabel: 'Live',
            modeTone: 'running',
            progress: computeLiveRefreshProgress(step),
        };
    }

    if (phase === 'idle' || phase === 'snapshot') {
        return {
            actionLabel: 'Richiedi nuovi dati live',
            actionMeta: 'Il backend live e disponibile: questo pulsante contatta davvero la sorgente prima di aggiornare la dashboard.',
            modeLabel: 'Live',
            modeTone: 'live',
            progress: 0,
        };
    }

    return {
        actionLabel: 'Richiedi nuovi dati live',
        actionMeta: 'Il backend live e disponibile.',
        modeLabel: 'Live',
        modeTone: 'live',
        progress: 0,
    };
}

function startLiveRefreshAnimation() {
    stopLiveRefreshAnimation();
    const simulatedSteps = [
        {
            step: 'triggering_source',
            message: 'Sto chiedendo alla fonte di preparare un nuovo snapshot.',
            detail: 'Il backend sta contattando MeteoProject per forzare la pubblicazione dei dati piu recenti.',
        },
        {
            step: 'downloading_csv',
            message: 'Sto scaricando il CSV piu recente dalla sorgente.',
            detail: 'Appena il backend riceve il payload, passa alla validazione e alla rigenerazione degli artefatti.',
        },
        {
            step: 'validating',
            message: 'Sto validando il payload ricevuto dalla fonte.',
            detail: 'Controllo integrita, freshness e formato prima di sostituire lo snapshot pubblicato.',
        },
        {
            step: 'publishing',
            message: 'Sto pubblicando il nuovo snapshot della dashboard.',
            detail: 'Manca solo la sincronizzazione finale del frontend con i file appena aggiornati.',
        },
    ];
    let index = 0;

    state.liveRefresh.animationTimer = window.setInterval(() => {
        if (!state.liveRefresh.running) {
            stopLiveRefreshAnimation();
            return;
        }

        const current = simulatedSteps[Math.min(index, simulatedSteps.length - 1)];
        setLiveRefreshState({
            step: current.step,
            message: current.message,
            detail: current.detail,
            progress: computeLiveRefreshProgress(current.step),
        });
        index += 1;
    }, REFRESH_STAGE_ADVANCE_MS);
}

function stopLiveRefreshAnimation() {
    if (state.liveRefresh.animationTimer) {
        window.clearInterval(state.liveRefresh.animationTimer);
        state.liveRefresh.animationTimer = null;
    }
}

function computeLiveRefreshProgress(step) {
    switch (step) {
    case 'queued':
        return 12;
    case 'triggering_source':
        return 30;
    case 'downloading_csv':
        return 52;
    case 'validating':
        return 72;
    case 'publishing':
        return 88;
    case 'syncing-dashboard':
        return 92;
    case 'completed':
        return 100;
    default:
        return 18;
    }
}

function setLiveRefreshState(patch) {
    state.liveRefresh = {
        ...state.liveRefresh,
        ...patch,
    };
    renderLiveRefreshState();
}

function renderLiveRefreshState() {
    if (
        !elements.refreshNow
        || !elements.refreshConsole
        || !elements.refreshActionSummary
        || !elements.refreshActionMeta
        || !elements.refreshModePill
        || !elements.refreshButtonLabel
        || !elements.refreshProgressFill
        || !elements.refreshStepSource
        || !elements.refreshStepPublish
        || !elements.refreshStepSync
    ) {
        return;
    }

    const liveState = state.liveRefresh;
    elements.refreshActionSummary.textContent = liveState.message;
    elements.refreshActionMeta.textContent = liveState.detail || liveState.actionMeta;
    elements.refreshModePill.className = `refresh-mode-pill is-${liveState.modeTone}`;
    elements.refreshModePill.textContent = liveState.modeLabel;
    elements.refreshButtonLabel.textContent = liveState.actionLabel;
    elements.refreshProgressFill.style.width = `${Math.max(0, Math.min(100, liveState.progress))}%`;

    const buttonClasses = ['ghost-button', 'live-refresh-button'];
    const consoleClasses = ['refresh-console'];
    if (liveState.running || state.loading) {
        buttonClasses.push('is-busy');
    }

    if (liveState.running) {
        consoleClasses.push('is-active');
    } else if (liveState.phase === 'success') {
        buttonClasses.push('is-live-capable', 'is-success');
        consoleClasses.push('is-success');
    } else if (liveState.phase === 'error') {
        buttonClasses.push('is-error');
        consoleClasses.push('is-error');
    } else if (liveState.supported) {
        buttonClasses.push('is-live-capable');
        if (liveState.modeTone === 'live') {
            consoleClasses.push('is-success');
        }
    }

    elements.refreshNow.className = buttonClasses.join(' ');
    elements.refreshConsole.className = consoleClasses.join(' ');
    elements.refreshNow.disabled = state.loading || liveState.running || !liveState.supported;
    elements.refreshMonitor?.classList.toggle('is-active', liveState.running);

    updateRefreshStepState(liveState.step);
}

function updateRefreshStepState(step) {
    const sourceStep = step === 'queued' || step === 'triggering_source' || step === 'downloading_csv'
        ? 'current'
        : ['validating', 'publishing', 'syncing-dashboard', 'completed'].includes(step)
            ? 'complete'
            : step === 'failed'
                ? 'error'
                : 'idle';
    const publishStep = step === 'validating' || step === 'publishing'
        ? 'current'
        : ['syncing-dashboard', 'completed'].includes(step)
            ? 'complete'
            : step === 'failed'
                ? 'error'
                : 'idle';
    const syncStep = step === 'syncing-dashboard'
        ? 'current'
        : step === 'completed'
            ? 'complete'
            : step === 'failed'
                ? 'error'
                : 'idle';

    applyRefreshStepState(elements.refreshStepSource, sourceStep);
    applyRefreshStepState(elements.refreshStepPublish, publishStep);
    applyRefreshStepState(elements.refreshStepSync, syncStep);
}

function applyRefreshStepState(element, tone) {
    if (!element) {
        return;
    }

    element.className = 'refresh-step';
    if (tone === 'current') {
        element.classList.add('is-current');
    } else if (tone === 'complete') {
        element.classList.add('is-complete');
    } else if (tone === 'error') {
        element.classList.add('is-error');
    }
}

function pulseRefreshMonitor() {
    if (!elements.refreshMonitor) {
        return;
    }

    elements.refreshMonitor.classList.remove('is-live-pulse');
    void elements.refreshMonitor.offsetWidth;
    elements.refreshMonitor.classList.add('is-live-pulse');

    if (elements.currentCard) {
        elements.currentCard.classList.remove('is-celebrating');
        void elements.currentCard.offsetWidth;
        elements.currentCard.classList.add('is-celebrating');
    }
}

function selectMetric(metric, { scroll = false } = {}) {
    if (!metric || !state.availableMetrics.has(metric)) {
        return;
    }

    state.selectedMetric = metric;
    window.localStorage.setItem(STORAGE_KEY, metric);
    renderMetricState();
    renderChart();

    if (scroll && elements.chartPanel) {
        elements.chartPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function selectRange(range) {
    if (!RANGE_OPTIONS[range]) {
        return;
    }

    state.selectedRange = range;
    window.localStorage.setItem(RANGE_STORAGE_KEY, range);
    renderMetricState();
    renderChart();
}

function getDefaultRange() {
    return window.matchMedia('(max-width: 700px)').matches ? '6h' : '24h';
}

function applyChartDefaults() {
    if (!window.Chart) {
        return;
    }

    window.Chart.defaults.font.family = "'Manrope', sans-serif";
    window.Chart.defaults.color = '#5f7185';
    window.Chart.defaults.plugins.legend.labels.usePointStyle = true;
    window.Chart.defaults.plugins.legend.labels.boxWidth = 9;
    window.Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(16, 32, 51, 0.96)';
    window.Chart.defaults.plugins.tooltip.titleColor = '#ffffff';
    window.Chart.defaults.plugins.tooltip.bodyColor = '#e7eef7';
    window.Chart.defaults.plugins.tooltip.padding = 12;
    window.Chart.defaults.plugins.tooltip.cornerRadius = 12;
}

async function loadDashboard({ initial = false, force = false, silent = false, live = false } = {}) {
    if (state.loading) {
        if (!force) {
            return;
        }

        state.requestController?.abort();
    }

    const loadId = state.requestId + 1;
    const previousStatus = state.status;
    state.requestId = loadId;
    state.loading = true;
    state.requestController = new AbortController();
    setLoadingState(true, { initial, silent, manual: force, live });

    try {
        const [seriesResult, statusResult] = await Promise.allSettled([
            fetchJson(SERIES_URL, state.requestController.signal),
            fetchJson(STATUS_URL, state.requestController.signal),
        ]);

        const status = statusResult.status === 'fulfilled'
            ? normalizeStatus(statusResult.value)
            : normalizeStatus(null);

        if (loadId !== state.requestId) {
            return;
        }

        state.status = status;

        if (seriesResult.status !== 'fulfilled') {
            const error = seriesResult.reason;
            if (!state.records.length) {
                throw error;
            }

            setRefreshMonitorFailure(error, { initial: false, silent, live });
            renderDashboard();
            renderFailure(error);
            state.loading = false;
            setLoadingState(false, { initial: false, silent, failure: true, live });
            return;
        }

        const records = normalizeSeries(seriesResult.value);
        if (!records.length) {
            throw new Error('No usable records found in data/series.json');
        }

        if (loadId !== state.requestId) {
            return;
        }

        state.records = records;
        state.availableMetrics = detectAvailableMetrics(records);
        state.selectedMetric = resolveSelectedMetric(state.selectedMetric, state.availableMetrics);
        state.selectedRange = resolveSelectedRange(state.selectedRange);
        setRefreshMonitorSuccess({ previousStatus, currentStatus: status, initial, manual: force, live });

        renderDashboard();
        state.loading = false;
        setLoadingState(false, { initial: false, silent, live });
    } catch (error) {
        if (error.name === 'AbortError') {
            if (loadId === state.requestId) {
                state.loading = false;
            }
            return;
        }

        if (loadId !== state.requestId) {
            return;
        }

        console.error('Dashboard refresh failed:', error);
        state.loading = false;
        setRefreshMonitorFailure(error, { initial, silent, live });
        renderFailure(error);
        setLoadingState(false, { initial, silent, failure: true, live });
    }
}

async function fetchJson(url, signal) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const abortFromParent = () => controller.abort();
    if (signal) {
        if (signal.aborted) {
            controller.abort();
        } else {
            signal.addEventListener('abort', abortFromParent, { once: true });
        }
    }

    try {
        const response = await fetch(`${url}?v=${Date.now()}`, {
            cache: 'no-store',
            signal: controller.signal,
            headers: {
                Accept: 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`Request for ${url} failed with status ${response.status}`);
        }

        return response.json();
    } finally {
        window.clearTimeout(timeoutId);
        if (signal) {
            signal.removeEventListener('abort', abortFromParent);
        }
    }
}

function normalizeSeries(raw) {
    const records = extractArrayPayload(raw);

    return records
        .map((record, index) => normalizeRecord(record, index))
        .filter((record) => record.label && hasAnyMetricValue(record))
        .sort((left, right) => {
            if (left.sortKey !== null && right.sortKey !== null) {
                return left.sortKey - right.sortKey;
            }

            return left.index - right.index;
        });
}

function extractArrayPayload(raw) {
    if (Array.isArray(raw)) {
        return raw;
    }

    if (!raw || typeof raw !== 'object') {
        return [];
    }

    for (const key of ['records', 'observations', 'series', 'data', 'items', 'points']) {
        if (Array.isArray(raw[key])) {
            return raw[key];
        }
    }

    return [];
}

function normalizeRecord(record, index) {
    const lookup = buildLookup(record);
    const timestampInfo = resolveTimestamp(record, lookup);

    return {
        index,
        label: timestampInfo.label,
        sortKey: timestampInfo.sortKey,
        temperature: readNumber(record, lookup, FIELD_ALIASES.temperature),
        dewPoint: readNumber(record, lookup, FIELD_ALIASES.dewPoint),
        humidity: readNumber(record, lookup, FIELD_ALIASES.humidity),
        pressure: readNumber(record, lookup, FIELD_ALIASES.pressure),
        wind: readNumber(record, lookup, FIELD_ALIASES.wind),
        gust: readNumber(record, lookup, FIELD_ALIASES.gust),
        rain: readNumber(record, lookup, FIELD_ALIASES.rain),
        direction: readValue(record, lookup, FIELD_ALIASES.direction),
    };
}

function hasAnyMetricValue(record) {
    return ['temperature', 'dewPoint', 'humidity', 'pressure', 'wind', 'gust', 'rain'].some((key) => Number.isFinite(record[key]))
        || getDirectionIndex(record?.direction) !== null;
}

function buildLookup(record) {
    const lookup = new Map();

    Object.entries(record || {}).forEach(([key, value]) => {
        lookup.set(normalizeKey(key), value);
    });

    return lookup;
}

function normalizeKey(key) {
    return String(key || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '');
}

function readValue(record, lookup, keys) {
    for (const key of keys) {
        const normalized = normalizeKey(key);
        if (lookup.has(normalized)) {
            const value = lookup.get(normalized);
            if (value !== null && value !== undefined && value !== '') {
                return value;
            }
        }
    }

    for (const [recordKey, value] of Object.entries(record || {})) {
        if (keys.some((key) => normalizeKey(key) === normalizeKey(recordKey))) {
            if (value !== null && value !== undefined && value !== '') {
                return value;
            }
        }
    }

    return null;
}

function readNumber(record, lookup, keys) {
    const rawValue = readValue(record, lookup, keys);

    if (rawValue === null || rawValue === undefined) {
        return null;
    }

    if (typeof rawValue === 'number') {
        return Number.isFinite(rawValue) ? rawValue : null;
    }

    const normalized = String(rawValue).trim().replace(',', '.');
    if (!normalized || normalized.toUpperCase() === 'NULL' || normalized === '-') {
        return null;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

function resolveTimestamp(record, lookup) {
    const explicitTimestamp = readValue(record, lookup, FIELD_ALIASES.timestamp);
    if (explicitTimestamp) {
        const parsed = parseTimestampValue(explicitTimestamp);
        if (parsed) {
            return parsed;
        }
    }

    const datePart = readValue(record, lookup, FIELD_ALIASES.date);
    const clockPart = readValue(record, lookup, FIELD_ALIASES.clock);
    if (datePart && clockPart) {
        const combined = combineDateAndTime(datePart, clockPart);
        if (combined) {
            return combined;
        }
    }

    if (datePart) {
        const parsedDate = parseTimestampValue(datePart);
        if (parsedDate) {
            return parsedDate;
        }
    }

    return { label: `Riga ${record?.index ?? ''}`.trim(), sortKey: null };
}

function parseTimestampValue(value) {
    if (value instanceof Date && Number.isFinite(value.getTime())) {
        return {
            label: formatDateForDisplay(value),
            sortKey: value.getTime(),
        };
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        const date = new Date(value);
        if (Number.isFinite(date.getTime())) {
            return {
                label: formatDateForDisplay(date),
                sortKey: date.getTime(),
            };
        }
    }

    const text = String(value).trim();
    if (!text) {
        return null;
    }

    const isoCandidate = text.includes('T') ? text : text.replace(' ', 'T');
    const parsedIso = new Date(isoCandidate);
    if (Number.isFinite(parsedIso.getTime())) {
        return {
            label: formatDateForDisplay(parsedIso),
            sortKey: parsedIso.getTime(),
        };
    }

    const europeanMatch = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!europeanMatch) {
        return null;
    }

    const [, dayRaw, monthRaw, yearRaw, hourRaw = '0', minuteRaw = '0', secondRaw = '0'] = europeanMatch;
    const year = Number(yearRaw.length === 2 ? `20${yearRaw}` : yearRaw);
    const month = Number(monthRaw) - 1;
    const day = Number(dayRaw);
    const hour = Number(hourRaw);
    const minute = Number(minuteRaw);
    const second = Number(secondRaw);
    const date = new Date(year, month, day, hour, minute, second);

    if (!Number.isFinite(date.getTime())) {
        return null;
    }

    return {
        label: formatDateForDisplay(date),
        sortKey: date.getTime(),
    };
}

function combineDateAndTime(datePart, clockPart) {
    const dateText = String(datePart).trim();
    const timeText = String(clockPart).trim();
    const match = dateText.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
    if (!match) {
        return parseTimestampValue(`${dateText} ${timeText}`);
    }

    const [, dayRaw, monthRaw, yearRaw] = match;
    const timeMatch = timeText.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!timeMatch) {
        return null;
    }

    const [, hourRaw, minuteRaw, secondRaw = '0'] = timeMatch;
    const year = Number(yearRaw.length === 2 ? `20${yearRaw}` : yearRaw);
    const month = Number(monthRaw) - 1;
    const day = Number(dayRaw);
    const hour = Number(hourRaw);
    const minute = Number(minuteRaw);
    const second = Number(secondRaw);
    const date = new Date(year, month, day, hour, minute, second);

    if (!Number.isFinite(date.getTime())) {
        return null;
    }

    return {
        label: `${pad2(day)}/${pad2(month + 1)}/${year} ${pad2(hour)}:${pad2(minute)}`,
        sortKey: date.getTime(),
    };
}

function formatDateForDisplay(date) {
    return new Intl.DateTimeFormat('it-IT', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

function formatDateShort(date) {
    return new Intl.DateTimeFormat('it-IT', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

function pad2(value) {
    return String(value).padStart(2, '0');
}

function normalizeStatus(raw) {
    if (!raw || typeof raw !== 'object') {
        return {
            status: 'unknown',
            message: 'Nessuno status disponibile',
            stale: true,
            rowCount: null,
            sourceUpdatedAt: null,
            publishedAt: null,
            observationAgeMinutes: null,
            expectedCadenceMinutes: null,
            warnings: [],
            checks: [],
            triggerArchiveRefresh: null,
            raw: {},
        };
    }

    const lookup = buildLookup(raw);
    const status = String(readValue(raw, lookup, FIELD_ALIASES.status) || 'ok').toLowerCase();
    const message = String(readValue(raw, lookup, FIELD_ALIASES.message) || '').trim();
    const staleRaw = readValue(raw, lookup, FIELD_ALIASES.stale);
    const rowCount = readNumber(raw, lookup, FIELD_ALIASES.rowCount);
    const sourceUpdatedAt = parseTimestampValue(readValue(raw, lookup, FIELD_ALIASES.sourceUpdatedAt));
    const publishedAt = parseTimestampValue(readValue(raw, lookup, FIELD_ALIASES.publishedAt));

    return {
        status,
        message,
        stale: parseBoolean(staleRaw) || status === 'stale',
        rowCount,
        sourceUpdatedAt,
        publishedAt,
        observationAgeMinutes: readNumber(raw, lookup, FIELD_ALIASES.observationAgeMinutes),
        expectedCadenceMinutes: readNumber(raw, lookup, FIELD_ALIASES.expectedCadenceMinutes),
        warnings: Array.isArray(raw.warnings) ? raw.warnings : [],
        checks: Array.isArray(raw.checks) ? raw.checks : [],
        triggerArchiveRefresh: raw.triggerArchiveRefresh || null,
        raw,
    };
}

function parseBoolean(value) {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        return value !== 0;
    }

    if (typeof value !== 'string') {
        return false;
    }

    const normalized = value.trim().toLowerCase();
    return ['1', 'true', 'yes', 'y', 'on', 'stale', 'warning'].includes(normalized);
}

function detectAvailableMetrics(records) {
    const available = new Set();

    for (const metric of METRIC_ORDER) {
        if (records.some((record) => hasMetricChartData(record, metric))) {
            available.add(metric);
        }
    }

    return available;
}

function resolveSelectedMetric(selectedMetric, availableMetrics) {
    if (availableMetrics.has(selectedMetric)) {
        return selectedMetric;
    }

    return METRIC_ORDER.find((metric) => availableMetrics.has(metric)) || 'temperature';
}

function resolveSelectedRange(selectedRange) {
    return RANGE_OPTIONS[selectedRange] ? selectedRange : getDefaultRange();
}

function renderDashboard() {
    renderHero();
    renderSummary();
    renderMetricState();
    renderChart();
    renderHealth();
}

function renderHero() {
    const latest = state.records[state.records.length - 1];
    if (!latest) {
        renderHeroEmpty();
        return;
    }

    elements.heroTemperature.textContent = formatMetricCard('temperature', latest.temperature);
    elements.heroWind.textContent = formatMetricCard('wind', latest.wind);
    elements.heroDirection.textContent = formatDirectionWindow(latest.direction);
    elements.heroHumidity.textContent = formatMetricCard('humidity', latest.humidity);
    elements.heroPressure.textContent = formatMetricCard('pressure', latest.pressure);
    elements.heroNarrative.textContent = buildHeroNarrative(latest);
    elements.freshnessSummary.textContent = buildFreshnessHeadline();
    elements.lastUpdate.textContent = buildUpdateLine();
    renderRefreshMonitor();
    renderStatusDetails();
}

function renderHeroEmpty() {
    elements.heroTemperature.textContent = '--';
    elements.heroWind.textContent = '--';
    elements.heroDirection.textContent = '--';
    elements.heroHumidity.textContent = '--';
    elements.heroPressure.textContent = '--';
    elements.heroNarrative.textContent = 'Caricamento dati in corso.';
    elements.freshnessSummary.textContent = 'Sto recuperando gli ultimi dati disponibili.';
    elements.lastUpdate.textContent = 'Ultimo aggiornamento: in attesa dei dati';
    renderRefreshMonitor();
    renderStatusDetails();
}

function buildHeroNarrative(latest) {
    const parts = [];

    if (latest.wind !== null) {
        const direction = latest.direction ? ` da ${formatDirectionSentence(latest.direction)}` : '';
        parts.push(`Vento ${describeWind(latest.wind)}${direction}`);
    }

    if (latest.gust !== null) {
        parts.push(`raffiche fino a ${formatMetricCard('gust', latest.gust)}`);
    }

    if (latest.rain !== null && latest.rain > 0) {
        parts.push(`pioggia ${formatMetricCard('rain', latest.rain)}`);
    } else {
        parts.push('pioggia assente');
    }

    return parts.length ? `${capitalizeSentence(parts.join(' · '))}.` : 'In attesa di un campione valido.';
}

function simplifyDirection(value) {
    const label = formatDirectionCard(value);
    return label === 'n/d' ? label : label.split(' ')[0];
}

function buildFreshnessHeadline() {
    const ageMinutes = getObservationAgeMinutes();
    if (ageMinutes === null) {
        return 'Ultimo dato disponibile pronto per la lettura.';
    }

    if (ageMinutes <= 20) {
        return `Ultimo dato ${formatAge(ageMinutes)} fa.`;
    }

    if (ageMinutes <= getStaleThreshold()) {
        return `Ultimo dato ${formatAge(ageMinutes)} fa. La fonte principale non ha ancora pubblicato un aggiornamento piu recente.`;
    }

    return `Ultimo dato ${formatAge(ageMinutes)} fa. Sto mostrando l ultimo valore disponibile finche la fonte principale non pubblica un nuovo aggiornamento.`;
}

function buildUpdateLine() {
    const latest = state.records[state.records.length - 1];
    const publishedLabel = state.status?.publishedAt?.sortKey
        ? formatDateShort(new Date(state.status.publishedAt.sortKey))
        : null;
    const sourceLabel = state.status?.sourceUpdatedAt?.sortKey
        ? formatDateShort(new Date(state.status.sourceUpdatedAt.sortKey))
        : latest?.sortKey
            ? formatDateShort(new Date(latest.sortKey))
            : 'n/d';
    const rowCount = state.status?.rowCount || state.records.length;

    if (publishedLabel) {
        return `Pubblicato ${publishedLabel} · ultimo dato ${sourceLabel} · ${rowCount} campioni`;
    }

    return `Ultimo dato ${sourceLabel} · ${rowCount} campioni`;
}

function renderRefreshMonitor() {
    if (
        !elements.refreshMonitor
        || !elements.refreshMonitorBadge
        || !elements.refreshMonitorTitle
        || !elements.refreshMonitorBody
        || !elements.refreshCheckedAt
        || !elements.refreshPublishedAt
        || !elements.refreshSourceAt
    ) {
        return;
    }

    elements.refreshMonitor.className = 'refresh-monitor';
    if (state.refreshMonitor.tone === 'loading' || state.refreshMonitor.tone === 'live') {
        elements.refreshMonitor.classList.add('is-active');
    }
    elements.refreshMonitorBadge.className = `refresh-monitor-badge is-${state.refreshMonitor.tone}`;
    elements.refreshMonitorBadge.textContent = state.refreshMonitor.badgeLabel;
    elements.refreshMonitorTitle.textContent = state.refreshMonitor.title;
    elements.refreshMonitorBody.textContent = state.refreshMonitor.body;
    elements.refreshCheckedAt.textContent = formatMonitorDate(state.refreshMonitor.checkedAt);
    elements.refreshPublishedAt.textContent = formatMonitorTimestamp(state.status?.publishedAt);
    elements.refreshSourceAt.textContent = formatMonitorTimestamp(state.status?.sourceUpdatedAt);
}

function setRefreshMonitorLoading({ initial = false, manual = false, live = false } = {}) {
    state.refreshMonitor = {
        tone: 'loading',
        badgeLabel: live ? 'Refresh live' : manual ? 'Controllo manuale' : 'Controllo in corso',
        title: initial
            ? 'Sto caricando i dati pubblicati dal sito.'
            : live
                ? 'Sto chiedendo nuovi dati alla fonte e poi sincronizzando la dashboard.'
                : 'Sto ricontrollando i file pubblicati dal sito.',
        body: live
            ? 'Il backend sta contattando la sorgente, rigenerando lo snapshot e preparando l aggiornamento finale della dashboard.'
            : manual
            ? 'Sto verificando se il sito ha pubblicato un file piu recente e se dentro quel file compare un nuovo dato della fonte principale.'
            : 'Sto leggendo di nuovo i dati pubblicati per capire se la pipeline ha esposto novita della fonte principale.',
        checkedAt: state.refreshMonitor.checkedAt,
    };
    renderRefreshMonitor();
}

function compareRefreshStatus(previousStatus, currentStatus) {
    const previousPublishedAt = previousStatus?.publishedAt?.sortKey ?? null;
    const previousSourceAt = previousStatus?.sourceUpdatedAt?.sortKey ?? null;
    const currentPublishedAt = currentStatus?.publishedAt?.sortKey ?? null;
    const currentSourceAt = currentStatus?.sourceUpdatedAt?.sortKey ?? null;

    return {
        sitePublishedNewFile: Number.isFinite(currentPublishedAt)
            && (!Number.isFinite(previousPublishedAt) || currentPublishedAt > previousPublishedAt),
        sourcePublishedNewData: Number.isFinite(currentSourceAt)
            && (!Number.isFinite(previousSourceAt) || currentSourceAt > previousSourceAt),
    };
}

function setRefreshMonitorSuccess({ previousStatus, currentStatus, initial = false, manual = false, live = false } = {}) {
    const { sitePublishedNewFile, sourcePublishedNewData } = compareRefreshStatus(previousStatus, currentStatus);

    let tone = 'idle';
    let badgeLabel = 'Stato caricato';
    let title = 'Sto mostrando l ultimo snapshot pubblicato dal sito.';
    let body = 'Quando ricarichi, qui ti mostro se il sito ha pubblicato un nuovo file e se la fonte principale contiene un nuovo dato.';

    if (sourcePublishedNewData) {
        tone = 'live';
        badgeLabel = live ? 'Nuovo dato live' : 'Nuovo dato';
        title = live
            ? 'Il refresh live ha portato un nuovo dato nella dashboard.'
            : 'Il sito sta mostrando un nuovo dato pubblicato dalla fonte principale.';
        body = live
            ? `Ho richiesto nuovi dati alla fonte e ora la dashboard mostra il campione pubblicato alle ${formatMonitorTimestamp(currentStatus?.sourceUpdatedAt)}.`
            : `L ultimo dato della fonte e passato a ${formatMonitorTimestamp(currentStatus?.sourceUpdatedAt)} e il sito lo ha gia recepito.`;
    } else if (sitePublishedNewFile) {
        tone = 'waiting';
        badgeLabel = live ? 'Fonte invariata' : 'Fonte invariata';
        title = live
            ? 'Il refresh live ha rigenerato lo snapshot, ma la fonte non ha aggiunto un nuovo campione.'
            : 'Il sito ha pubblicato un nuovo file, ma la fonte principale non ha aggiunto un dato piu recente.';
        body = live
            ? `Lo snapshot e stato aggiornato alle ${formatMonitorTimestamp(currentStatus?.publishedAt)}, ma l ultimo dato fonte resta ${formatMonitorTimestamp(currentStatus?.sourceUpdatedAt)}.`
            : `La pubblicazione del sito e avanzata a ${formatMonitorTimestamp(currentStatus?.publishedAt)}, ma l ultimo dato della fonte resta ${formatMonitorTimestamp(currentStatus?.sourceUpdatedAt)}.`;
    } else if (initial) {
        tone = 'idle';
        badgeLabel = 'Prima lettura';
        title = 'Prima lettura completata.';
        body = 'Sto mostrando l ultimo file che il sito ha gia pubblicato. I prossimi controlli ti diranno se cambia la pubblicazione del sito o il dato della fonte.';
    } else {
        tone = 'waiting';
        badgeLabel = live ? 'Fonte controllata' : manual ? 'Nessuna novita' : 'Fonte invariata';
        title = live
            ? 'Refresh live completato senza nuovi dati dalla fonte.'
            : 'Controllo completato senza nuovi dati pubblicati.';
        body = live
            ? `Ho eseguito una richiesta live, ma l ultima pubblicazione resta ${formatMonitorTimestamp(currentStatus?.publishedAt)} e l ultimo dato fonte resta ${formatMonitorTimestamp(currentStatus?.sourceUpdatedAt)}.`
            : `Ho ricontrollato i file pubblicati del sito: l ultima pubblicazione resta ${formatMonitorTimestamp(currentStatus?.publishedAt)} e l ultimo dato della fonte resta ${formatMonitorTimestamp(currentStatus?.sourceUpdatedAt)}.`;
    }

    state.refreshMonitor = {
        tone,
        badgeLabel,
        title,
        body,
        checkedAt: Date.now(),
    };
}

function setRefreshMonitorFailure(error, { initial = false, silent = false, live = false } = {}) {
    if (silent) {
        return;
    }

    state.refreshMonitor = {
        tone: 'error',
        badgeLabel: live ? 'Refresh live fallito' : 'Controllo fallito',
        title: initial
            ? 'Il primo controllo dei dati pubblicati non e riuscito.'
            : live
                ? 'La richiesta live non e riuscita.'
                : 'Non sono riuscito a ricontrollare i file pubblicati dal sito.',
        body: live
            ? `Continuo a mostrare l ultimo snapshot valido. Dettaglio backend: ${sanitizeText(error?.message || 'errore sconosciuto')}.`
            : `Sto continuando a mostrare l ultimo snapshot disponibile. Dettaglio: ${sanitizeText(error?.message || 'errore sconosciuto')}.`,
        checkedAt: Date.now(),
    };
    renderRefreshMonitor();
}

function formatMonitorTimestamp(timestampInfo) {
    if (!timestampInfo?.sortKey) {
        return 'n/d';
    }

    return formatDateShort(new Date(timestampInfo.sortKey));
}

function formatMonitorDate(value) {
    if (!value) {
        return 'n/d';
    }

    return formatDateShort(new Date(value));
}

function renderStatusDetails() {
    if (!elements.statusDetails || !elements.statusDetailsList || !elements.statusDetailsSummary) {
        return;
    }

    const items = [];
    const ageMinutes = getObservationAgeMinutes();
    const cadence = state.status?.expectedCadenceMinutes;

    if (ageMinutes !== null) {
        items.push(`Ultima osservazione ricevuta ${formatAge(ageMinutes)} fa.`);
    }

    if (Number.isFinite(cadence)) {
        items.push(`Cadenza attesa: una misura ogni ${Math.round(cadence)} minuti.`);
    }

    state.status?.checks?.forEach((check) => {
        if (check?.details) {
            const prefix = check.ok ? 'Controllo ok' : 'Attenzione';
            items.push(`${prefix}: ${sanitizeText(check.details)}.`);
        }
    });

    state.status?.warnings?.forEach((warning) => {
        items.push(`Avviso: ${sanitizeText(warning)}.`);
    });

    if (state.status?.triggerArchiveRefresh?.attempted && state.status.triggerArchiveRefresh.details) {
        items.push(sanitizeText(state.status.triggerArchiveRefresh.details));
    }

    if (!items.length) {
        elements.statusDetails.hidden = true;
        elements.statusDetailsList.replaceChildren();
        return;
    }

    elements.statusDetails.hidden = false;
    elements.statusDetailsSummary.textContent = 'Dettagli affidabilita';
    elements.statusDetailsList.replaceChildren(...items.map((item) => {
        const li = document.createElement('li');
        li.textContent = item;
        return li;
    }));
}

function renderSummary() {
    const latest = state.records[state.records.length - 1];
    if (!latest) {
        renderSummarySkeleton();
        return;
    }

    const primaryCards = [
        createSummaryCard({
            label: 'Temperatura',
            value: formatMetricCard('temperature', latest.temperature),
            note: buildDeltaNote('temperature', 60, 'Variazione nell ultima ora'),
            targetMetric: 'temperature',
            tone: 'warm',
            primary: true,
        }),
        createSummaryCard({
            label: 'Vento',
            value: formatMetricCard('wind', latest.wind),
            note: latest.gust !== null ? `Raffica ${formatMetricCard('gust', latest.gust)}` : 'Velocita media attuale',
            targetMetric: 'wind',
            tone: 'gold',
            primary: true,
        }),
        createSummaryCard({
            label: 'Umidita',
            value: formatMetricCard('humidity', latest.humidity),
            note: buildDeltaNote('humidity', 60, 'Valore relativo'),
            targetMetric: 'humidity',
            tone: 'green',
            primary: true,
        }),
    ].filter(Boolean);

    const secondaryCards = [
        createSummaryCard({
            label: 'Pressione',
            value: formatMetricCard('pressure', latest.pressure),
            note: buildDeltaNote('pressure', 60, 'Trend barometrico'),
            targetMetric: 'pressure',
            tone: 'blue',
        }),
        createSummaryCard({
            label: 'Raffica',
            value: formatMetricCard('gust', latest.gust),
            note: 'Picco dell ultima lettura',
            targetMetric: 'wind',
            tone: 'gold',
        }),
        createSummaryCard({
            label: 'Pioggia',
            value: formatMetricCard('rain', latest.rain),
            note: 'Ultimo valore registrato',
            targetMetric: 'rain',
            tone: 'blue',
        }),
        createSummaryCard({
            label: 'Dew point',
            value: formatMetricCard('dewPoint', latest.dewPoint),
            note: 'Compagno della temperatura',
            targetMetric: 'temperature',
            tone: 'warm',
        }),
        createSummaryCard({
            label: 'Direzione',
            value: formatDirectionWindow(latest.direction),
            note: 'Direzione del vento',
            targetMetric: 'wind',
            tone: 'blue',
            cardClassName: 'is-direction',
        }),
    ].filter(Boolean);

    elements.summaryPrimary.replaceChildren(...primaryCards);
    elements.summarySecondary.replaceChildren(...secondaryCards);

    const rowCount = state.status?.rowCount || state.records.length;
    elements.summaryMeta.textContent = `Tocca una scheda per aprire il trend · ${rowCount} campioni disponibili`;
    syncSummarySelectionState();
}

function renderSummarySkeleton() {
    if (!elements.summaryPrimary || !elements.summarySecondary) {
        return;
    }

    const primaryCards = Array.from({ length: 3 }, (_, index) => createSkeletonCard(index === 0));
    const secondaryCards = Array.from({ length: 4 }, () => createSkeletonCard(false));
    elements.summaryPrimary.replaceChildren(...primaryCards);
    elements.summarySecondary.replaceChildren(...secondaryCards);
}

function createSkeletonCard(isPrimary) {
    const card = document.createElement('div');
    card.className = `summary-card is-skeleton ${isPrimary ? 'is-primary' : 'is-secondary'}`;

    const label = document.createElement('div');
    label.className = 'skeleton-line';

    const value = document.createElement('div');
    value.className = 'skeleton-block';

    const note = document.createElement('div');
    note.className = 'skeleton-line long';

    card.append(label, value, note);
    return card;
}

function createSummaryCard({ label, value, note, targetMetric, tone, primary = false, cardClassName = '' }) {
    if (!value || value === 'n/d') {
        return null;
    }

    const card = document.createElement('button');
    const cardClasses = ['summary-card', primary ? 'is-primary' : 'is-secondary'];
    if (tone) {
        cardClasses.push(`tone-${tone}`);
    }
    if (cardClassName) {
        cardClasses.push(cardClassName);
    }

    card.type = 'button';
    card.className = cardClasses.join(' ');
    card.dataset.targetMetric = targetMetric;
    card.setAttribute('aria-pressed', targetMetric === state.selectedMetric ? 'true' : 'false');

    const title = document.createElement('p');
    title.className = 'summary-label';
    title.textContent = label;

    const reading = document.createElement('p');
    reading.className = 'summary-value';
    reading.textContent = value;

    const noteElement = document.createElement('p');
    noteElement.className = 'summary-note';
    noteElement.textContent = note;

    card.append(title, reading, noteElement);
    card.addEventListener('click', () => {
        selectMetric(targetMetric, { scroll: true });
    });

    return card;
}

function syncSummarySelectionState() {
    const cards = document.querySelectorAll('.summary-card[data-target-metric]');
    cards.forEach((card) => {
        const active = card.dataset.targetMetric === state.selectedMetric;
        card.classList.toggle('is-active', active);
        card.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

function buildDeltaNote(metric, minutes, fallback) {
    const latest = state.records[state.records.length - 1];
    const previous = getRecordAtMinutesAgo(minutes);
    const latestValue = latest ? getMetricValue(latest, metric) : null;
    const previousValue = previous ? getMetricValue(previous, metric) : null;

    if (latestValue === null || previousValue === null) {
        return fallback;
    }

    const delta = latestValue - previousValue;
    const sign = delta > 0 ? '+' : delta < 0 ? '-' : '';
    return `${minutes / 60}h: ${sign}${formatMetricCard(metric, Math.abs(delta))}`;
}

function getRecordAtMinutesAgo(minutes) {
    if (!state.records.length) {
        return null;
    }

    const latest = state.records[state.records.length - 1];
    if (!Number.isFinite(latest.sortKey)) {
        const fallbackStep = estimateSampleCountForMinutes(minutes);
        return state.records[Math.max(0, state.records.length - 1 - fallbackStep)] || null;
    }

    const targetTime = latest.sortKey - (minutes * 60000);
    for (let index = state.records.length - 1; index >= 0; index -= 1) {
        const record = state.records[index];
        if (Number.isFinite(record.sortKey) && record.sortKey <= targetTime) {
            return record;
        }
    }

    return state.records[0] || null;
}

function estimateSampleCountForMinutes(minutes) {
    const cadence = Number.isFinite(state.status?.expectedCadenceMinutes)
        ? Math.max(1, state.status.expectedCadenceMinutes)
        : 15;
    return Math.max(1, Math.round(minutes / cadence));
}

function renderMetricState() {
    const metric = METRICS[state.selectedMetric] || METRICS.temperature;
    const latest = state.records[state.records.length - 1];
    const hasLatestValue = latest ? hasMetricChartData(latest, state.selectedMetric) : false;
    const filteredRecords = filterRecordsByRange(state.records, state.selectedRange);
    const rangeLabel = describeRange(state.selectedRange);

    elements.metricButtons.forEach((button) => {
        const metricName = button.dataset.metric;
        const active = metricName === state.selectedMetric;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    elements.rangeButtons.forEach((button) => {
        const active = button.dataset.range === state.selectedRange;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    elements.chartTitle.textContent = `Trend ${metric.label.toLowerCase()}`;
    if (!state.records.length) {
        elements.chartSubtitle.textContent = 'Nessun dato disponibile al momento.';
    } else if (!hasLatestValue) {
        elements.chartSubtitle.textContent = `${rangeLabel} · nessun valore valido per questa metrica.`;
    } else {
        elements.chartSubtitle.textContent = `${rangeLabel} · ultimo valore ${formatTrendSnapshot(latest, state.selectedMetric)} · ${filteredRecords.length} punti in vista.`;
    }

    if (!elements.chartEmptyState) {
        return;
    }

    const shouldShowEmpty = !state.records.length || !window.Chart;
    elements.chartEmptyState.hidden = !shouldShowEmpty;
    elements.canvas.hidden = shouldShowEmpty;

    if (shouldShowEmpty && !window.Chart) {
        const title = elements.chartEmptyState.querySelector('h3');
        const description = elements.chartEmptyState.querySelector('p:last-of-type');
        if (title) {
            title.textContent = 'Grafico non disponibile';
        }
        if (description) {
            description.textContent = 'Caricamento della libreria grafica fallito.';
        }
    }

    renderMetricSwitcher();
    syncSummarySelectionState();
}

function renderMetricSwitcher() {
    elements.metricButtons.forEach((button) => {
        const metric = button.dataset.metric;
        const available = state.availableMetrics.has(metric);
        button.disabled = !available;
        button.classList.toggle('is-disabled', !available);
        button.setAttribute('aria-disabled', available ? 'false' : 'true');
        button.title = available ? '' : 'Dato non disponibile';
    });
}

function renderChart() {
    if (!window.Chart || !state.records.length) {
        return;
    }

    const config = buildChartConfig(state.selectedMetric);
    if (!config) {
        showEmptyChart('Nessun dato disponibile', 'Non ci sono punti utili nell intervallo selezionato.');
        return;
    }

    elements.chartEmptyState.hidden = true;
    elements.canvas.hidden = false;

    if (state.chart) {
        state.chart.destroy();
    }

    state.chart = new window.Chart(elements.canvas, config);
}

function buildChartConfig(metricName) {
    const metric = METRICS[metricName];
    if (!metric) {
        return null;
    }

    const filteredRecords = filterRecordsByRange(state.records, state.selectedRange);
    const companionMetric = metric.companion ? METRICS[metric.companion] : null;
    const latestSortKey = filteredRecords[filteredRecords.length - 1]?.sortKey ?? null;
    const isWind = metricName === 'wind';

    const chartRows = filteredRecords
        .map((record) => {
            const primary = getMetricValue(record, metricName);
            const companion = metric.companion ? getMetricValue(record, metric.companion) : null;
            const direction = isWind ? getDirectionIndex(record.direction) : null;
            return {
                fullLabel: record.label,
                tickLabel: buildAxisLabel(record.sortKey, latestSortKey),
                primary,
                companion,
                direction,
                rawDirection: record.direction,
            };
        })
        .filter((row) => row.primary !== null || row.companion !== null || row.direction !== null);

    if (!chartRows.length) {
        return null;
    }

    const labels = chartRows.map((row) => row.tickLabel);
    const isRain = metricName === 'rain';
    const hasDirectionDataset = isWind && chartRows.some((row) => row.direction !== null);
    const datasetCount = (companionMetric ? 2 : 1) + (hasDirectionDataset ? 1 : 0);

    const datasets = isRain
        ? [{
            type: 'bar',
            label: metric.label,
            data: chartRows.map((row) => row.primary),
            backgroundColor: hexToRgba(metric.color, 0.72),
            borderColor: metric.color,
            borderRadius: 8,
            borderWidth: 1,
            maxBarThickness: 18,
        }]
        : [{
            type: 'line',
            label: metric.label,
            data: chartRows.map((row) => row.primary),
            borderColor: metric.color,
            backgroundColor: hexToRgba(metric.color, 0.16),
            pointBackgroundColor: metric.color,
            pointBorderColor: '#ffffff',
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHitRadius: 18,
            tension: 0.28,
            borderWidth: 2.5,
            fill: true,
            spanGaps: true,
        }];

    if (!isRain && companionMetric) {
        datasets.push({
            type: 'line',
            label: companionMetric.label,
            data: chartRows.map((row) => row.companion),
            borderColor: companionMetric.color,
            backgroundColor: hexToRgba(companionMetric.color, 0.12),
            pointBackgroundColor: companionMetric.color,
            pointBorderColor: '#ffffff',
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHitRadius: 18,
            tension: 0.28,
            borderWidth: 2,
            fill: false,
            spanGaps: true,
        });
    }

    if (hasDirectionDataset) {
        datasets.push({
            type: 'line',
            label: METRICS.direction.label,
            data: chartRows.map((row) => row.direction),
            borderColor: METRICS.direction.color,
            backgroundColor: hexToRgba(METRICS.direction.color, 0.08),
            pointBackgroundColor: METRICS.direction.color,
            pointBorderColor: '#ffffff',
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHitRadius: 18,
            borderWidth: 2,
            fill: false,
            spanGaps: true,
            stepped: true,
            yAxisID: 'yDirection',
        });
    }

    return {
        type: isRain ? 'bar' : 'line',
        data: {
            labels,
            datasets,
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    display: datasetCount > 1,
                    position: 'top',
                    align: 'start',
                },
                tooltip: {
                    callbacks: {
                        title(context) {
                            return chartRows[context[0]?.dataIndex]?.fullLabel || '';
                        },
                        label(context) {
                            const row = chartRows[context.dataIndex] || null;
                            const datasetLabel = context.dataset.label || '';
                            const value = context.parsed.y;
                            if (value === null || value === undefined) {
                                return `${datasetLabel}: n/d`;
                            }

                            if (context.dataset.yAxisID === 'yDirection') {
                                return `${datasetLabel}: ${formatDirectionCard(row?.rawDirection ?? value)}`;
                            }

                            const unit = context.dataset.label === companionMetric?.label ? companionMetric.unit : metric.unit;
                            return `${datasetLabel}: ${formatMetricNumber(value, unitDigits(unit))}${unit ? ` ${unit}` : ''}`;
                        },
                    },
                },
                decimation: !isRain ? {
                    enabled: chartRows.length > 80,
                    algorithm: 'min-max',
                } : undefined,
            },
            scales: {
                x: {
                    grid: {
                        display: false,
                    },
                    ticks: {
                        autoSkip: true,
                        maxTicksLimit: getMaxTicks(),
                        color: '#6b7f93',
                    },
                },
                y: {
                    beginAtZero: isRain,
                    title: {
                        display: true,
                        text: metric.axisLabel,
                        color: '#5f7185',
                    },
                    ticks: {
                        color: '#6b7f93',
                    },
                    grid: {
                        color: 'rgba(95, 113, 133, 0.12)',
                    },
                },
                yDirection: hasDirectionDataset ? {
                    position: 'right',
                    min: 0,
                    max: COMPASS_DIRECTIONS.length - 1,
                    title: {
                        display: true,
                        text: METRICS.direction.axisLabel,
                        color: '#5f7185',
                    },
                    ticks: {
                        stepSize: 1,
                        color: '#6b7f93',
                        callback(value) {
                            return formatDirectionTick(value);
                        },
                    },
                    grid: {
                        drawOnChartArea: false,
                    },
                } : undefined,
            },
        },
    };
}

function getMaxTicks() {
    if (window.innerWidth <= 480) {
        return 4;
    }

    if (window.innerWidth <= 700) {
        return 5;
    }

    if (window.innerWidth <= 960) {
        return 7;
    }

    return 9;
}

function filterRecordsByRange(records, rangeKey) {
    if (!records.length || !RANGE_OPTIONS[rangeKey]) {
        return records;
    }

    const latestRecord = records[records.length - 1];
    const minutes = RANGE_OPTIONS[rangeKey].minutes;

    if (!Number.isFinite(latestRecord.sortKey)) {
        return records.slice(-estimateSampleCountForMinutes(minutes));
    }

    const cutoff = latestRecord.sortKey - (minutes * 60000);
    const filtered = records.filter((record) => Number.isFinite(record.sortKey) && record.sortKey >= cutoff);
    if (filtered.length >= 2) {
        return filtered;
    }

    return records.slice(-estimateSampleCountForMinutes(minutes));
}

function buildAxisLabel(sortKey, referenceSortKey) {
    if (!Number.isFinite(sortKey)) {
        return '';
    }

    const date = new Date(sortKey);
    const referenceDate = Number.isFinite(referenceSortKey) ? new Date(referenceSortKey) : null;
    const sameDay = referenceDate
        && date.getDate() === referenceDate.getDate()
        && date.getMonth() === referenceDate.getMonth()
        && date.getFullYear() === referenceDate.getFullYear();

    return sameDay
        ? new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' }).format(date)
        : new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

function getMetricValue(record, metric) {
    switch (metric) {
        case 'temperature':
            return record.temperature;
        case 'dewPoint':
            return record.dewPoint;
        case 'humidity':
            return record.humidity;
        case 'pressure':
            return record.pressure;
        case 'wind':
            return record.wind;
        case 'gust':
            return record.gust;
        case 'rain':
            return record.rain;
        default:
            return null;
    }
}

function hasMetricChartData(record, metric) {
    if (!record) {
        return false;
    }

    if (metric === 'wind') {
        return getMetricValue(record, 'wind') !== null
            || getMetricValue(record, 'gust') !== null
            || getDirectionIndex(record.direction) !== null;
    }

    return getMetricValue(record, metric) !== null;
}

function formatTrendSnapshot(record, metric) {
    if (!record) {
        return 'n/d';
    }

    if (metric === 'wind') {
        const speed = Number.isFinite(record.wind) ? formatMetricCard('wind', record.wind) : null;
        const direction = simplifyDirection(record.direction);
        if (speed && direction !== 'n/d') {
            return `${speed} da ${direction}`;
        }
        if (direction !== 'n/d') {
            return direction;
        }
        return speed || 'n/d';
    }

    return formatMetricValue(metric, getMetricValue(record, metric));
}

function hexToRgba(hex, alpha) {
    const cleanHex = hex.replace('#', '');
    const fullHex = cleanHex.length === 3
        ? cleanHex.split('').map((part) => part + part).join('')
        : cleanHex;

    const red = Number.parseInt(fullHex.slice(0, 2), 16);
    const green = Number.parseInt(fullHex.slice(2, 4), 16);
    const blue = Number.parseInt(fullHex.slice(4, 6), 16);

    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function renderHealth() {
    const status = state.status;
    const freshnessIsStale = isFreshnessStale(status);
    const hasWarning = freshnessIsStale || status?.status === 'degraded' || status?.stale;
    const hasError = status?.status === 'error' || !state.records.length;

    if (hasError && !state.records.length) {
        setPill('Dati non disponibili', 'is-error');
        setBanner('Non riesco a caricare i dati della stazione in questo momento.', 'error');
        elements.freshnessSummary.textContent = 'Dati non disponibili al momento.';
        elements.lastUpdate.textContent = 'Ultimo aggiornamento: non disponibile';
        return;
    }

    if (hasWarning) {
        const pillText = freshnessIsStale ? 'Ultimo dato disponibile' : 'In attesa di nuovi dati';
        setPill(pillText, 'is-stale');
        setBanner(buildWarningMessage(), 'warning');
        elements.freshnessSummary.textContent = buildFreshnessHeadline();
        elements.lastUpdate.textContent = buildUpdateLine();
        return;
    }

    setPill('Dati aggiornati', 'is-live');
    clearBanner();
    elements.freshnessSummary.textContent = buildFreshnessHeadline();
    elements.lastUpdate.textContent = buildUpdateLine();
}

function buildWarningMessage() {
    const ageMinutes = getObservationAgeMinutes();
    if (ageMinutes !== null && ageMinutes > getStaleThreshold()) {
        return `La fonte principale non ha ancora pubblicato un dato piu recente. Sto mostrando l ultimo valore disponibile, aggiornato ${formatAge(ageMinutes)} fa, e continuo a ricontrollare periodicamente.`;
    }

    if (ageMinutes !== null) {
        return `La fonte principale non ha ancora pubblicato un dato piu recente. La pagina continua a ricontrollare periodicamente i dati pubblicati.`;
    }

    if (state.status?.message) {
        return sanitizeText(state.status.message);
    }

    return 'La fonte principale non ha ancora pubblicato un aggiornamento piu recente. Continuo a ricontrollare periodicamente.';
}

function isFreshnessStale(status) {
    if (!status) {
        return false;
    }

    if (status.stale) {
        return true;
    }

    const ageMinutes = getObservationAgeMinutes();
    return ageMinutes !== null && ageMinutes > getStaleThreshold();
}

function getObservationAgeMinutes() {
    if (Number.isFinite(state.status?.observationAgeMinutes)) {
        return state.status.observationAgeMinutes;
    }

    if (state.status?.sourceUpdatedAt?.sortKey) {
        return (Date.now() - state.status.sourceUpdatedAt.sortKey) / 60000;
    }

    return null;
}

function getStaleThreshold() {
    const rawThreshold = state.status?.raw?.staleAfterMinutes;
    return Number.isFinite(Number(rawThreshold)) ? Number(rawThreshold) : STALE_THRESHOLD_MINUTES;
}

function setLoadingState(isLoading, { initial = false, silent = false, failure = false, manual = false, live = false } = {}) {
    if (elements.refreshNow) {
        elements.refreshNow.disabled = isLoading || state.liveRefresh.running || !state.liveRefresh.supported;
    }
    renderLiveRefreshState();

    if (isLoading && !silent) {
        setRefreshMonitorLoading({ initial, manual, live });
        setPill(initial ? 'Caricamento dati' : live ? 'Refresh live in corso' : 'Aggiornamento in corso', 'is-loading');
        if (initial) {
            setBanner('Sto caricando i dati piu recenti della stazione.', 'info');
        } else if (live) {
            setBanner('Sto chiedendo nuovi dati alla fonte e poi rileggo subito lo snapshot aggiornato.', 'info');
        }

        if (!state.records.length) {
            renderSummarySkeleton();
            renderHeroEmpty();
        }
        return;
    }

    if (!isLoading && failure && !state.records.length) {
        setPill('Errore sorgente', 'is-error');
    }
}

function setPill(text, modifier) {
    if (!elements.connectionPill) {
        return;
    }

    elements.connectionPill.className = `status-pill ${modifier}`;
    elements.connectionPill.textContent = text;
}

function setBanner(text, tone) {
    if (!elements.statusBanner) {
        return;
    }

    elements.statusBanner.hidden = false;
    elements.statusBanner.className = `status-banner is-${tone}`;
    elements.statusBanner.textContent = text;
}

function clearBanner() {
    if (!elements.statusBanner) {
        return;
    }

    elements.statusBanner.hidden = true;
    elements.statusBanner.textContent = '';
}

function renderFailure(error) {
    if (!state.records.length) {
        showEmptyChart('Dati non disponibili', 'Non riesco a mostrare il grafico senza un campione valido.');
        renderHeroEmpty();
    }

    const message = sanitizeText(error?.message || 'Errore sconosciuto');
    if (state.records.length) {
        setBanner(`Aggiornamento fallito. Sto mostrando l ultimo dato valido. Dettaglio: ${message}`, 'warning');
        setPill('Aggiornamento fallito', 'is-stale');
        elements.freshnessSummary.textContent = 'Aggiornamento fallito: sto mantenendo l ultimo dato valido.';
        elements.lastUpdate.textContent = buildUpdateLine();
        return;
    }

    setBanner(`Impossibile caricare i dati. Dettaglio: ${message}`, 'error');
    setPill('Errore sorgente', 'is-error');
    elements.freshnessSummary.textContent = 'Dati non disponibili al momento.';
    elements.lastUpdate.textContent = 'Ultimo aggiornamento: non disponibile';
    elements.summaryMeta.textContent = 'Nessun dato disponibile';
    elements.summaryPrimary.replaceChildren();
    elements.summarySecondary.replaceChildren(createInfoCard('Stato', 'n/d', 'Attendi il prossimo refresh'));
    renderStatusDetails();
}

function createInfoCard(label, value, note) {
    const card = document.createElement('div');
    card.className = 'summary-card is-secondary';

    const title = document.createElement('p');
    title.className = 'summary-label';
    title.textContent = label;

    const reading = document.createElement('p');
    reading.className = 'summary-value';
    reading.textContent = value;

    const noteElement = document.createElement('p');
    noteElement.className = 'summary-note';
    noteElement.textContent = note;

    card.append(title, reading, noteElement);
    return card;
}

function showEmptyChart(titleText, descriptionText) {
    const title = elements.chartEmptyState?.querySelector('h3');
    const description = elements.chartEmptyState?.querySelector('p:last-of-type');
    if (title) {
        title.textContent = titleText;
    }
    if (description) {
        description.textContent = descriptionText;
    }
    if (elements.chartEmptyState) {
        elements.chartEmptyState.hidden = false;
    }
    if (elements.canvas) {
        elements.canvas.hidden = true;
    }
}

function degreesToDirection(degrees) {
    const normalized = ((Number(degrees) % 360) + 360) % 360;
    const index = Math.round(normalized / DIRECTION_STEP_DEGREES) % COMPASS_DIRECTIONS.length;
    return COMPASS_DIRECTIONS_IT[index];
}

function getDirectionIndex(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    if (typeof value === 'string') {
        const normalized = value.trim().toUpperCase();
        const compassIndex = COMPASS_DIRECTIONS.indexOf(normalized);
        if (compassIndex >= 0) {
            return compassIndex;
        }
    }

    const numeric = Number(String(value).replace(',', '.'));
    if (!Number.isFinite(numeric)) {
        return null;
    }

    const normalized = ((numeric % 360) + 360) % 360;
    return Math.round(normalized / DIRECTION_STEP_DEGREES) % COMPASS_DIRECTIONS.length;
}

function formatDirectionTick(value) {
    const index = Math.round(Number(value));
    return COMPASS_DIRECTIONS_IT[index] || '';
}

function formatMetricValue(metric, value) {
    if (value === null || value === undefined || Number.isNaN(value)) {
        return 'n/d';
    }

    if (metric === 'direction') {
        return formatDirectionCard(value);
    }

    return formatMetricCard(metric, value);
}

function formatMetricCard(metric, value) {
    if (value === null || value === undefined || Number.isNaN(value)) {
        return 'n/d';
    }

    switch (metric) {
        case 'temperature':
        case 'dewPoint':
            return `${formatMetricNumber(value, 1)} C`;
        case 'humidity':
            return `${formatMetricNumber(value, 0)} %`;
        case 'pressure':
            return `${formatMetricNumber(value, 1)} hPa`;
        case 'wind':
        case 'gust':
            return `${formatMetricNumber(value, 1)} km/h`;
        case 'rain':
            return `${formatMetricNumber(value, 1)} mm`;
        default:
            return formatMetricNumber(value, 1);
    }
}

function formatDirectionCard(value) {
    if (value === null || value === undefined || value === '') {
        return 'n/d';
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return `${degreesToDirection(value)} (${Math.round(value)} deg)`;
    }

    const numeric = Number(String(value).replace(',', '.'));
    if (Number.isFinite(numeric)) {
        return `${degreesToDirection(numeric)} (${Math.round(numeric)} deg)`;
    }

    const normalized = String(value).trim().toUpperCase();
    const compassIndex = COMPASS_DIRECTIONS.indexOf(normalized);
    if (compassIndex >= 0) {
        return COMPASS_DIRECTIONS_IT[compassIndex];
    }

    return String(value);
}

function formatDirectionWindow(value) {
    const shortLabel = formatDirectionCard(value);
    if (shortLabel === 'n/d') {
        return shortLabel;
    }

    const baseLabel = shortLabel.split(' (')[0];
    const compassIndex = COMPASS_DIRECTIONS_IT.indexOf(baseLabel);
    if (compassIndex >= 0) {
        return COMPASS_DIRECTIONS_FULL_IT[compassIndex];
    }

    return shortLabel;
}

function formatDirectionSentence(value) {
    const fullLabel = formatDirectionWindow(value);
    return fullLabel === 'n/d' ? fullLabel : fullLabel.toLowerCase();
}

function formatMetricNumber(value, digits = 1) {
    return new Intl.NumberFormat('it-IT', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    }).format(value);
}

function unitDigits(unit) {
    if (unit === '%') {
        return 0;
    }
    return 1;
}

function describeRange(rangeKey) {
    const option = RANGE_OPTIONS[rangeKey];
    if (!option) {
        return 'Intervallo corrente';
    }

    if (rangeKey === '1h') {
        return 'Ultima ora';
    }

    return `Ultime ${option.label}`;
}

function describeWind(value) {
    if (!Number.isFinite(value)) {
        return 'non disponibile';
    }

    if (value < 5) {
        return 'debole';
    }

    if (value < 15) {
        return 'moderato';
    }

    if (value < 30) {
        return 'sostenuto';
    }

    return 'forte';
}

function formatAge(minutes) {
    const rounded = Math.max(0, Math.round(minutes));
    if (rounded < 60) {
        return `${rounded} min`;
    }

    const hours = Math.floor(rounded / 60);
    const mins = rounded % 60;
    if (mins === 0) {
        return `${hours} h`;
    }

    return `${hours} h ${mins} min`;
}

function capitalizeSentence(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) {
        return '';
    }
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function sanitizeText(text) {
    return String(text || '')
        .replace(/`/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
