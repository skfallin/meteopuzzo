import requests
import pandas as pd
from datetime import datetime
import logging
from io import StringIO
import sys

# Set up logging to stdout for GitHub Actions
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)

def get_csv_url():
    # Get today's date
    today = datetime.now()
    # Format date parameters for URL
    params = {
        'gg': today.day,
        'mm': today.month,
        'aa': today.year % 100,  # Last two digits of year
        'gg2': today.day,
        'mm2': today.month,
        'aa2': today.year % 100
    }
    return f"https://stazioni.meteoproject.it/dati/montenero/csv.php?gg={params['gg']}&mm={params['mm']}&aa={params['aa']}&gg2={params['gg2']}&mm2={params['mm2']}&aa2={params['aa2']}"

def convert_to_numeric(series):
    """Convert a pandas series to numeric, handling both string and numeric inputs."""
    if pd.api.types.is_numeric_dtype(series):
        return series
    return pd.to_numeric(series.astype(str).str.replace(',', '.'), errors='coerce')

def download_weather_data():
    try:
        url = get_csv_url()
        logging.info(f"Downloading data from {url}")
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/csv,text/plain,*/*',
        }
        
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        
        # Log the response status and content type
        logging.info(f"Response status: {response.status_code}")
        logging.info(f"Content type: {response.headers.get('content-type', 'unknown')}")
        
        # Read CSV directly into DataFrame using StringIO from io module
        df = pd.read_csv(StringIO(response.text), sep=';')
        
        # Log the data types of columns before conversion
        logging.info("Column data types before conversion:")
        logging.info(df.dtypes)
        
        # Clean up column names to match what the JavaScript expects
        column_mapping = {
            'Data': 'Data',
            'Ora': 'Ora',
            'Temp': 'Temp',
            'Umid': 'Umid',
            'Press': 'Press',
            'Vento': 'Vento',
            'Raffica': 'Raffica',
            'Dir': 'Direzione',
            'Pioggia': 'Precip',
            'Rad.Sol.': 'Radiazione'
        }
        
        # Rename columns based on mapping
        df.columns = [column_mapping.get(col, col) for col in df.columns]
        
        # Convert numeric columns
        numeric_columns = ['Temp', 'Umid', 'Press', 'Vento', 'Raffica', 'Precip', 'Radiazione']
        for col in numeric_columns:
            if col in df.columns:
                df[col] = convert_to_numeric(df[col])
        
        # Log the data types of columns after conversion
        logging.info("Column data types after conversion:")
        logging.info(df.dtypes)
        
        # Save to CSV with semicolon separator
        df.to_csv('export.csv', index=False, sep=';', encoding='utf-8')
        logging.info("Successfully updated export.csv")
        
    except Exception as e:
        logging.error("Error updating weather data: %s", str(e), exc_info=True)

def main():
    logging.info("Starting weather data update")
    download_weather_data()
    logging.info("Weather data update completed")

if __name__ == "__main__":
    main() 