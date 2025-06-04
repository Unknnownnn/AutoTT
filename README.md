# Automatic Image to Google Calender for tables

A CLI based python program to automatically sync data extracted from an image using pytesseract and OCR and export to Google Calender using 

<br/>

## Set Up Google Calendar API

a. Go to Google Cloud Console:
    https://console.cloud.google.com/
    
b. Create a project or use an existing one.
c. Enable Google Calendar API:
  - Go to APIs & Services > Library
  - Search for Google Calendar API
  - Click Enable

d. Create OAuth credentials:
  - Go to APIs & Services > Credentials
  - Click Create Credentials > OAuth client ID
  - Choose "Desktop App"
  - Download the file and rename it to `credentials.json`
  - Keep this file in the same folder as the program

## Set Up AutoTT

1. Ensure python and pip are installed
2. Install Tesseract OCR to your System and add it to the PATH, or save to `C:\Program Files (x86)\Tesseract`

    https://tesseract-ocr.github.io/

3. Install requirements for the program
```
pip install -r requirements.txt
```
4. Run the CLI application using
```
python calendar_sync.py
```
