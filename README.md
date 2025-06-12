# Stazione Meteo Montenero

A real-time weather station website displaying meteorological data from Montenero, Italy.

## Features

- Real-time weather data updates every 15 minutes
- Interactive charts showing temperature, humidity, pressure, wind, and precipitation
- Data sourced from [MeteoProject](https://stazioni.meteoproject.it/dati/montenero/)

## Technical Details

- Frontend: HTML, CSS, JavaScript with Chart.js for data visualization
- Backend: Python script for data collection and processing
- Hosting: GitHub Pages with GitHub Actions for automated updates
- Data Storage: CSV file updated every 15 minutes

## Local Development

1. Clone the repository
2. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Run the update script:
   ```bash
   python update_data.py
   ```
4. Open `index.htm` in your browser to view the website

## Website

The website is hosted at: [https://YOUR_USERNAME.github.io/meteopuzzo/](https://YOUR_USERNAME.github.io/meteopuzzo/)

(Replace YOUR_USERNAME with your GitHub username after deployment) 