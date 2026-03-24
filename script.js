const SERIES_URL = 'data/series.json';
const STATUS_URL = 'data/status.json';
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12000;
const STALE_THRESHOLD_MINUTES = 90;
const STORAGE_KEY = 'meteopuzzo.selectedMetric';

const METRICS = {
    temperature: {
        label: 'Temperatura',
        unit: 'C',
        axisLabel: 'Temperatura (C)',
        color: '#ff8f6b',
        companion: 'dewPoint',
    },
    humidity: {
        label: 'Umidita',
        unit: '%',
        axisLabel: 'Umidita (%)',
        color: '#4fd1c5',
    },
    pressure: {
        label: 'Pressione',
        unit: 'hPa',
        axisLabel: 'Pressione (hPa)',
        color: '#7dd3fc',
    },
    wind: {
        label: 'Vento',
        unit: 'km/h',
        axisLabel: 'Vento (km/h)',
        color: '#fbbf24',
        companion: 'gust',
    },
    rain: {
        label: 'Pioggia',
        unit: 'mm',
        axisLabel: 'Pioggia (mm)',
        color: '#a78bfa',
    },
};

const METRIC_ORDER = ['temperature', 'humidity', 'pressure', 'wind', 'rain'];

const FIELD_ALIASES = {
    timestamp: ['timestamp', 'datetime', 'dateTime', 'dataora', 'datetimeiso', 'iso', 'date_time', 'observedAt', 'time', 'ts'],
    date: ['date', 'data', 'day'],
    clock: ['time', 'ora', 'hour'],
    temperature: ['temperature', 'temp', 'temperatura', 'temperatureC', 'tempC'],
    dewPoint: ['dewPoint', 'dewpt', 'dew_pt', 'dew pt', 'dew', 'puntoRugiada', 'dewPointC'],
    humidity: ['humidity', 'hum', 'umid', 'umidita', 'umidità', 'humidityPct'],
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
};

const state = {
    chart: null,
    records: [],
    status: null,
    selectedMetric: window.localStorage.getItem(STORAGE_KEY) || 'temperature',
    loading: false,
    requestController: null,
    requestId: 0,
    availableMetrics: new Set(),
};

const elements = {};

document.addEventListener('DOMContentLoaded', init);

async function init() {
    cacheElements();
    bindActions();
    applyChartDefaults();
    await loadDashboard({ initial: true });
    window.setInterval(() => {
        loadDashboard({ silent: true });
    }, REFRESH_INTERVAL_MS);
}

function cacheElements() {
    elements.connectionPill = document.getElementById('connectionPill');
    elements.lastUpdate = document.getElementById('lastUpdate');
    elements.refreshNow = document.getElementById('refreshNow');
    elements.summaryGrid = document.getElementById('summaryGrid');
    elements.summaryMeta = document.getElementById('summaryMeta');
    elements.chartTitle = document.getElementById('chartTitle');
    elements.chartSubtitle = document.getElementById('chartSubtitle');
    elements.chartEmptyState = document.getElementById('chartEmptyState');
    elements.statusBanner = document.getElementById('statusBanner');
    elements.metricButtons = Array.from(document.querySelectorAll('.metric-button'));
    elements.canvas = document.getElementById('myChart');
}

function bindActions() {
    elements.refreshNow?.addEventListener('click', () => loadDashboard({ force: true }));

    elements.metricButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const metric = button.dataset.metric;
            if (!metric || !state.availableMetrics.has(metric)) {
                return;
            }

            state.selectedMetric = metric;
            window.localStorage.setItem(STORAGE_KEY, metric);
            renderMetricState();
            renderChart();
        });
    });
}

function applyChartDefaults() {
    if (!window.Chart) {
        return;
    }

    window.Chart.defaults.font.family = "'Manrope', sans-serif";
    window.Chart.defaults.color = '#d7e4f7';
    window.Chart.defaults.plugins.legend.labels.usePointStyle = true;
    window.Chart.defaults.plugins.legend.labels.boxWidth = 10;
    window.Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(7, 17, 29, 0.96)';
    window.Chart.defaults.plugins.tooltip.titleColor = '#ffffff';
    window.Chart.defaults.plugins.tooltip.bodyColor = '#d7e4f7';
    window.Chart.defaults.plugins.tooltip.padding = 12;
    window.Chart.defaults.plugins.tooltip.cornerRadius = 12;
}

async function loadDashboard({ initial = false, force = false, silent = false } = {}) {
    if (state.loading) {
        if (!force) {
            return;
        }

        state.requestController?.abort();
    }

    const loadId = state.requestId + 1;
    state.requestId = loadId;
    state.loading = true;
    state.requestController = new AbortController();
    setLoadingState(true, { initial, silent });

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

            renderDashboard();
            renderFailure(error);
            state.loading = false;
            setLoadingState(false, { initial: false, silent, failure: true });
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

        renderDashboard();
        state.loading = false;
        setLoadingState(false, { initial: false, silent });
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
        renderFailure(error);
        setLoadingState(false, { initial, silent, failure: true });
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
    return ['temperature', 'dewPoint', 'humidity', 'pressure', 'wind', 'gust', 'rain'].some((key) => Number.isFinite(record[key]));
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
        stale: parseBoolean(staleRaw) || status === 'stale' || status === 'degraded',
        rowCount,
        sourceUpdatedAt,
        publishedAt,
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
        if (records.some((record) => getMetricValue(record, metric) !== null)) {
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

function renderDashboard() {
    renderMetricSwitcher();
    renderSummary();
    renderMetricState();
    renderChart();
    renderHealth();
}

function renderMetricSwitcher() {
    elements.metricButtons.forEach((button) => {
        const metric = button.dataset.metric;
        const available = state.availableMetrics.has(metric);
        button.disabled = !available;
        button.classList.toggle('is-active', metric === state.selectedMetric);
        button.classList.toggle('is-disabled', !available);
        button.setAttribute('aria-selected', metric === state.selectedMetric ? 'true' : 'false');
    });
}

function renderSummary() {
    const latest = state.records[state.records.length - 1];
    const cards = [];

    if (latest) {
        pushSummaryCard(cards, 'Temperatura', latest.temperature, 'temperature', 'Ultimo dato disponibile');
        pushSummaryCard(cards, 'Umidita', latest.humidity, 'humidity', 'Percentuale relativa');
        pushSummaryCard(cards, 'Pressione', latest.pressure, 'pressure', 'Valore barometrico');
        pushSummaryCard(cards, 'Vento', latest.wind, 'wind', 'Velocita media');
        pushSummaryCard(cards, 'Raffica', latest.gust, 'gust', 'Picco registrato');
        pushSummaryCard(cards, 'Pioggia', latest.rain, 'rain', 'Cumulata / evento');
        pushSummaryCard(cards, 'Dew point', latest.dewPoint, 'dewPoint', 'Punto di rugiada');
        if (latest.direction !== null && latest.direction !== undefined && latest.direction !== '') {
            cards.push(createSummaryCard('Direzione', formatDirectionCard(latest.direction), 'Direzione del vento'));
        }
    }

    elements.summaryGrid.replaceChildren(...cards.filter(Boolean));

    const rowCount = state.status?.rowCount;
    const sourceLabel = state.status?.status ? `Stato sorgente: ${capitalize(state.status.status)}` : 'Stato sorgente: n/d';
    const freshnessLabel = describeFreshness();
    const sampleLabel = rowCount ? `${rowCount} campioni` : `${state.records.length} campioni`;
    elements.summaryMeta.textContent = [sourceLabel, sampleLabel, freshnessLabel].filter(Boolean).join(' · ');
}

function pushSummaryCard(cards, label, value, metric, hint) {
    if (value === null || value === undefined) {
        return;
    }

    cards.push(createSummaryCard(label, formatMetricCard(metric, value), hint));
}

function createSummaryCard(label, value, hint) {
    const card = document.createElement('article');
    card.className = 'summary-card';

    const title = document.createElement('p');
    title.className = 'summary-label';
    title.textContent = label;

    const reading = document.createElement('p');
    reading.className = 'summary-value';
    reading.textContent = value;

    const note = document.createElement('p');
    note.className = 'summary-hint';
    note.textContent = hint;

    card.append(title, reading, note);
    return card;
}

function formatMetricCard(metric, value) {
    if (value === null || value === undefined || Number.isNaN(value)) {
        return 'n/d';
    }

    switch (metric) {
        case 'temperature':
        case 'dewPoint':
            return `${formatNumber(value, 1)} C`;
        case 'humidity':
            return `${formatNumber(value, 0)} %`;
        case 'pressure':
            return `${formatNumber(value, 1)} hPa`;
        case 'wind':
        case 'gust':
            return `${formatNumber(value, 1)} km/h`;
        case 'rain':
            return `${formatNumber(value, 1)} mm`;
        default:
            return formatNumber(value, 1);
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

    return String(value);
}

function formatNumber(value, digits = 1) {
    return new Intl.NumberFormat('it-IT', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    }).format(value);
}

function capitalize(text) {
    return String(text || '').charAt(0).toUpperCase() + String(text || '').slice(1);
}

function describeFreshness() {
    if (state.status?.publishedAt?.label && state.status?.sourceUpdatedAt?.label) {
        return `Pubblicato alle ${state.status.publishedAt.label} · ultimo dato sorgente ${state.status.sourceUpdatedAt.label}`;
    }

    if (state.status?.publishedAt?.label) {
        return `Pubblicato alle ${state.status.publishedAt.label}`;
    }

    if (state.status?.sourceUpdatedAt?.label) {
        return `Ultimo dato sorgente ${state.status.sourceUpdatedAt.label}`;
    }

    return 'Freshness non dichiarata';
}

function renderChart() {
    if (!window.Chart || !state.records.length) {
        return;
    }

    const config = buildChartConfig(state.selectedMetric);
    if (!config) {
        elements.chartEmptyState.hidden = false;
        elements.canvas.hidden = true;
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

    const companionMetric = metric.companion ? METRICS[metric.companion] : null;
    const chartRows = state.records
        .map((record) => {
            const primary = getMetricValue(record, metricName);
            const companion = metric.companion ? getMetricValue(record, metric.companion) : null;
            return {
                label: record.label,
                primary,
                companion,
            };
        })
        .filter((row) => row.primary !== null || row.companion !== null);

    if (!chartRows.length) {
        return null;
    }

    const labels = chartRows.map((row) => row.label);
    const datasets = [{
        label: metric.label,
        data: chartRows.map((row) => row.primary),
        borderColor: metric.color,
        backgroundColor: hexToRgba(metric.color, 0.18),
        pointBorderColor: '#ffffff',
        pointBackgroundColor: metric.color,
        pointRadius: 2,
        pointHoverRadius: 5,
        tension: 0.3,
        borderWidth: 2,
        fill: true,
    }];

    if (companionMetric) {
        datasets.push({
            label: companionMetric.label,
            data: chartRows.map((row) => row.companion),
            borderColor: companionMetric.color,
            backgroundColor: hexToRgba(companionMetric.color, 0.12),
            pointBorderColor: '#ffffff',
            pointBackgroundColor: companionMetric.color,
            pointRadius: 2,
            pointHoverRadius: 5,
            tension: 0.3,
            borderWidth: 2,
            fill: false,
        });
    }

    return {
        type: 'line',
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
                    position: 'top',
                    align: 'start',
                },
                tooltip: {
                    callbacks: {
                        title(context) {
                            return context[0]?.label || '';
                        },
                        label(context) {
                            const datasetLabel = context.dataset.label || '';
                            const value = context.parsed.y;
                            if (value === null || value === undefined) {
                                return `${datasetLabel}: n/d`;
                            }

                            return `${datasetLabel}: ${formatNumber(value, 1)} ${metric.unit}`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    grid: {
                        display: false,
                    },
                    ticks: {
                        maxRotation: 0,
                        autoSkip: true,
                        color: '#c7d5ea',
                    },
                },
                y: {
                    title: {
                        display: true,
                        text: metric.axisLabel,
                    },
                    ticks: {
                        color: '#c7d5ea',
                    },
                    grid: {
                        color: 'rgba(199, 213, 234, 0.12)',
                    },
                },
            },
        },
    };
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
    const hasWarning = freshnessIsStale || status?.stale || status?.status === 'degraded';
    const hasError = status?.status === 'error' || !state.records.length;

    if (hasError && !state.records.length) {
        setPill('Dati non disponibili', 'is-error');
        setBanner('Non e stato possibile caricare i dati della stazione. Controlla che `data/series.json` e `data/status.json` siano pubblicati dal workflow.', 'error');
        elements.lastUpdate.textContent = 'Ultimo aggiornamento: non disponibile';
        return;
    }

    if (hasWarning) {
        const pillText = status?.status === 'degraded' && !status?.stale ? 'Sorgente in ritardo' : 'Dato stale';
        setPill(pillText, 'is-stale');
        setBanner(buildWarningMessage(), 'warning');
        updateLastUpdateLine();
        return;
    }

    setPill('Dati live', 'is-live');
    clearBanner();
    updateLastUpdateLine();
}

function buildWarningMessage() {
    if (state.status?.status === 'degraded' && state.status?.publishedAt?.label && state.status?.sourceUpdatedAt?.label) {
        return `Ultima pubblicazione ${state.status.publishedAt.label}, ma MeteoProject espone ancora come ultimo dato ${state.status.sourceUpdatedAt.label}. Il problema e a monte, non nel deploy del sito.`;
    }

    if (state.status?.message) {
        return state.status.message;
    }

    if (state.status?.sourceUpdatedAt?.label) {
        return `La sorgente segnala un dato non fresco. Ultimo dato noto: ${state.status.sourceUpdatedAt.label}.`;
    }

    return 'La sorgente dati e temporaneamente degradata. Il grafico mostra l ultimo dato valido disponibile.';
}

function isFreshnessStale(status) {
    if (!status) {
        return false;
    }

    if (status.stale) {
        return true;
    }

    const referenceDate = status.sourceUpdatedAt?.sortKey ? new Date(status.sourceUpdatedAt.sortKey) : null;
    if (!referenceDate) {
        return false;
    }

    const ageMinutes = (Date.now() - referenceDate.getTime()) / 60000;
    const rawThreshold = state.status?.raw?.staleAfterMinutes;
    const threshold = Number.isFinite(Number(rawThreshold)) ? Number(rawThreshold) : STALE_THRESHOLD_MINUTES;
    return Number.isFinite(ageMinutes) && ageMinutes > threshold;
}

function updateLastUpdateLine() {
    const latest = state.records[state.records.length - 1];
    const publishedLabel = state.status?.publishedAt?.label || null;
    const sourceLabel = state.status?.sourceUpdatedAt?.label || latest?.label || 'n/d';
    const rowCount = state.status?.rowCount || state.records.length;
    const suffix = rowCount ? ` · ${rowCount} campioni` : '';

    if (publishedLabel) {
        elements.lastUpdate.textContent = `Ultima pubblicazione: ${publishedLabel} · ultimo dato sorgente: ${sourceLabel}${suffix}`;
        return;
    }

    elements.lastUpdate.textContent = `Ultimo dato sorgente: ${sourceLabel}${suffix}`;
}

function setLoadingState(isLoading, { initial = false, silent = false, failure = false } = {}) {
    elements.refreshNow.disabled = isLoading;
    elements.refreshNow.textContent = isLoading ? 'Aggiornamento...' : 'Aggiorna ora';

    if (isLoading && !silent) {
        setPill(initial ? 'Caricamento dati' : 'Aggiornamento in corso', 'is-loading');
        if (initial) {
            setBanner('Caricamento dati dalla sorgente in corso.', 'info');
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
        elements.chartEmptyState.hidden = false;
        elements.canvas.hidden = true;
    }

    const message = error?.message || 'Errore sconosciuto';
    if (state.records.length) {
        setBanner(`Aggiornamento fallito. Sto mantenendo l ultimo dato valido. Dettaglio: ${message}`, 'warning');
        setPill('Aggiornamento fallito', 'is-stale');
        updateLastUpdateLine();
        return;
    }

    setBanner(`Impossibile caricare i dati. Dettaglio: ${message}`, 'error');
    setPill('Errore sorgente', 'is-error');
    elements.lastUpdate.textContent = 'Ultimo aggiornamento: non disponibile';
    elements.summaryMeta.textContent = 'Nessun dato disponibile';
    elements.summaryGrid.replaceChildren(createSummaryCard('Stato', 'n/d', 'Attendi il prossimo refresh'));
}

function degreesToDirection(degrees) {
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const normalized = ((Number(degrees) % 360) + 360) % 360;
    const index = Math.round(normalized / 22.5) % directions.length;
    return directions[index];
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

function getLatestMetricValue(metric) {
    const latest = state.records[state.records.length - 1];
    return latest ? getMetricValue(latest, metric) : null;
}

function renderMetricState() {
    const metric = METRICS[state.selectedMetric] || METRICS.temperature;
    const latest = state.records[state.records.length - 1];
    const latestValue = latest ? getMetricValue(latest, state.selectedMetric) : null;

    elements.metricButtons.forEach((button) => {
        const metricName = button.dataset.metric;
        button.classList.toggle('is-active', metricName === state.selectedMetric);
    });

    elements.chartTitle.textContent = metric.label;
    if (!state.records.length) {
        elements.chartSubtitle.textContent = 'Nessun dato disponibile al momento.';
    } else if (latestValue === null) {
        elements.chartSubtitle.textContent = `Serie disponibile da ${state.records.length} campioni.`;
    } else {
        elements.chartSubtitle.textContent = `Ultimo campione ${latest.label} · valore attuale ${formatMetricCard(state.selectedMetric, latestValue)}.`;
    }

    if (!elements.chartEmptyState) {
        return;
    }

    const shouldShowEmpty = !state.records.length || !window.Chart;
    elements.chartEmptyState.hidden = !shouldShowEmpty;
    elements.canvas.hidden = shouldShowEmpty;

    if (shouldShowEmpty && !window.Chart) {
        const title = elements.chartEmptyState.querySelector('h3');
        const description = elements.chartEmptyState.querySelector('p');
        if (title) {
            title.textContent = 'Chart.js non e disponibile';
        }
        if (description) {
            description.textContent = 'Caricamento libreria grafico fallito.';
        }
    }

    renderMetricSwitcher();
}
