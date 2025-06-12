// Function to parse date from CSV format (dd/mm/yyyy)
function parseDate(dateStr, timeStr) {
    const [day, month, year] = dateStr.split('/');
    const [hours, minutes] = timeStr.split(':');
    // Create date with explicit values (month is 0-based in JavaScript)
    return new Date(year, month - 1, day, hours, minutes);
}

// Function to update the last update time
function updateLastUpdateTime() {
    const lastUpdateElement = document.getElementById('lastUpdate');
    if (lastUpdateElement) {
        // Get the last label from the chart data (most recent entry)
        const chart = Chart.getChart('myChart');
        if (chart && chart.data.labels.length > 0) {
            const lastLabel = chart.data.labels[chart.data.labels.length - 1];
            // Parse the date from the label which is in format "dd/mm/yyyy HH:mm"
            const [datePart, timePart] = lastLabel.split(' ');
            const lastUpdate = parseDate(datePart, timePart);
            
            // Format date as dd/mm/yyyy
            const day = lastUpdate.getDate().toString().padStart(2, '0');
            const month = (lastUpdate.getMonth() + 1).toString().padStart(2, '0');
            const year = lastUpdate.getFullYear();
            const hours = lastUpdate.getHours().toString().padStart(2, '0');
            const minutes = lastUpdate.getMinutes().toString().padStart(2, '0');
            lastUpdateElement.textContent = `${day}/${month}/${year} ${hours}:${minutes}`;
        }
    }
}

// Function to fetch and parse CSV data
async function fetchData() {
    try {
        // Add timestamp to prevent caching
        const timestamp = new Date().getTime();
        const response = await fetch(`export.csv?t=${timestamp}`, {
            cache: 'no-store',
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });
        const csvText = await response.text();
        const lines = csvText.split('\n');
        
        // Skip header and empty lines
        const dataLines = lines.slice(1).filter(line => line.trim() && !line.includes('Unita di misura'));
        
        const labels = [];
        const tempData = [];
        const humData = [];
        const pressData = [];
        
        dataLines.forEach(line => {
            const [date, time, temp, min, max, hum, dew, wind, dir, gust, gustDir, press] = line.split(';');
            if (date && time && temp && hum && press) {
                // Keep the original date format from CSV
                const dateTime = `${date} ${time}`;
                labels.push(dateTime);
                tempData.push(parseFloat(temp));
                humData.push(parseFloat(hum));
                pressData.push(parseFloat(press));
            }
        });

        // Draw the chart with the data
        drawChart(labels, tempData, humData, pressData);
        
        // Update the last update time after drawing the chart
        updateLastUpdateTime();
        
    } catch (error) {
        console.error('Error fetching or parsing CSV:', error);
    }
}

// Initial data fetch
fetchData();

// Refresh data every 5 minutes (300000 ms) instead of 15 minutes
setInterval(fetchData, 300000);

// Remove the interval for updating the last update time since we don't need it anymore
// The last update time will be updated only when new data is fetched

function parseCSV(text) {
    const lines = text.trim().split('\n');
    const headers = lines[0].trim().split(';');
    const dateIdx = headers.indexOf('Data');
    const timeIdx = headers.indexOf('Ora');
    const tempIdx = headers.indexOf('Temp');
    const humIdx = headers.indexOf('Umid');
    const pressIdx = headers.indexOf('Press');

    const labels = [];
    const tempData = [];
    const humData = [];
    const pressData = [];

    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].trim().split(';');

        // Skip rows with missing or malformed data
        if (
            cols.length <= Math.max(dateIdx, timeIdx, tempIdx, humIdx, pressIdx) ||
            !cols[dateIdx] || !cols[timeIdx] || !cols[tempIdx]
        ) {
            console.warn("Skipping malformed row:", i, cols);
            continue;
        }

        const datetime = `${cols[dateIdx]} ${cols[timeIdx]}`;
        const temp = parseFloat(cols[tempIdx].replace(',', '.'));
        const hum = parseFloat(cols[humIdx].replace(',', '.'));
        const press = parseFloat(cols[pressIdx].replace(',', '.'));

        labels.push(datetime);
        tempData.push(temp);
        humData.push(hum);
        pressData.push(press);
    }

    return { labels, tempData, humData, pressData };
}

function drawChart(labels, tempData, humData, pressData) {
    const ctx = document.getElementById('myChart').getContext('2d');
    
    // Chart.js global defaults
    Chart.defaults.font.family = "'Roboto', sans-serif";
    Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 4;
    Chart.defaults.plugins.tooltip.displayColors = true;
    Chart.defaults.plugins.tooltip.boxWidth = 8;
    Chart.defaults.plugins.tooltip.boxHeight = 8;
    Chart.defaults.plugins.tooltip.usePointStyle = true;

    new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Temperatura',
                    data: tempData,
                    borderColor: '#FF6384',
                    backgroundColor: 'rgba(255, 99, 132, 0.1)',
                    yAxisID: 'yTemp',
                    tension: 0.4,
                    pointRadius: 2,
                    pointHoverRadius: 4,
                    pointHoverBorderWidth: 2,
                    pointHoverBackgroundColor: '#FF6384',
                    pointHoverBorderColor: '#fff',
                    borderWidth: 2,
                    spanGaps: false
                },
                {
                    label: 'Umidità',
                    data: humData,
                    borderColor: '#36A2EB',
                    backgroundColor: 'rgba(54, 162, 235, 0.1)',
                    yAxisID: 'yHum',
                    tension: 0.4,
                    pointRadius: 2,
                    pointHoverRadius: 4,
                    pointHoverBorderWidth: 2,
                    pointHoverBackgroundColor: '#36A2EB',
                    pointHoverBorderColor: '#fff',
                    borderWidth: 2,
                    spanGaps: false
                },
                {
                    label: 'Pressione',
                    data: pressData,
                    borderColor: '#4BC0C0',
                    backgroundColor: 'rgba(75, 192, 192, 0.1)',
                    yAxisID: 'yPress',
                    tension: 0.4,
                    pointRadius: 2,
                    pointHoverRadius: 4,
                    pointHoverBorderWidth: 2,
                    pointHoverBackgroundColor: '#4BC0C0',
                    pointHoverBorderColor: '#fff',
                    borderWidth: 2,
                    spanGaps: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2,
            interaction: {
                mode: 'index',
                axis: 'x',
                intersect: false
            },
            plugins: {
                legend: {
                    position: 'top',
                    align: 'start',
                    labels: {
                        boxWidth: 12,
                        padding: 15,
                        font: {
                            size: 12
                        },
                        usePointStyle: true
                    }
                },
                tooltip: {
                    enabled: true,
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        title: function(context) {
                            const label = context[0].label;
                            const date = new Date(label);
                            return date.toLocaleString('it-IT', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                            });
                        },
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.dataset.yAxisID === 'yTemp') {
                                label += context.parsed.y.toFixed(1) + '°C';
                            } else if (context.dataset.yAxisID === 'yHum') {
                                label += context.parsed.y.toFixed(1) + '%';
                            } else if (context.dataset.yAxisID === 'yPress') {
                                label += context.parsed.y.toFixed(1) + ' hPa';
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        display: true,
                        color: 'rgba(0, 0, 0, 0.1)'
                    },
                    ticks: {
                        maxRotation: 0,
                        minRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: 12,
                        font: {
                            size: 11
                        },
                        padding: 10,
                        callback: function(value, index, values) {
                            const label = this.getLabelForValue(value);
                            const date = new Date(label);
                            // Only show hour:minute for better readability
                            return date.toLocaleString('it-IT', {
                                hour: '2-digit',
                                minute: '2-digit'
                            });
                        }
                    },
                    border: {
                        display: true
                    },
                    offset: false
                },
                yTemp: {
                    type: 'linear',
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Temperatura (°C)',
                        font: {
                            weight: 'bold',
                            size: 12
                        },
                        padding: {top: 10, bottom: 10}
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.1)'
                    },
                    border: {
                        display: true
                    },
                    ticks: {
                        padding: 10,
                        font: {
                            size: 11
                        },
                        callback: function(value) {
                            return value.toFixed(1);
                        }
                    }
                },
                yHum: {
                    type: 'linear',
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Umidità (%)',
                        font: {
                            weight: 'bold',
                            size: 12
                        },
                        padding: {top: 10, bottom: 10}
                    },
                    grid: {
                        display: false
                    },
                    border: {
                        display: true
                    },
                    ticks: {
                        padding: 10,
                        font: {
                            size: 11
                        },
                        callback: function(value) {
                            return value.toFixed(1);
                        }
                    }
                },
                yPress: {
                    type: 'linear',
                    position: 'right',
                    offset: true,
                    title: {
                        display: true,
                        text: 'Pressione (hPa)',
                        font: {
                            weight: 'bold',
                            size: 12
                        },
                        padding: {top: 10, bottom: 10}
                    },
                    grid: {
                        display: false
                    },
                    border: {
                        display: true
                    },
                    ticks: {
                        padding: 10,
                        font: {
                            size: 11
                        },
                        callback: function(value) {
                            return value.toFixed(1);
                        }
                    }
                }
            }
        }
    });
}
