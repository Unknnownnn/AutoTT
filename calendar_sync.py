from __future__ import print_function
import datetime
import os.path
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from main import main as process_timetable
from datetime import datetime, timedelta

# Scope for calendar access
SCOPES = ['https://www.googleapis.com/auth/calendar.events']

def get_google_calendar_service():
    creds = None

    # Load token if it exists
    if os.path.exists('token.json'):
        creds = Credentials.from_authorized_user_file('token.json', SCOPES)

    # Authenticate if no valid credentials
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file('credentials.json', SCOPES)
            creds = flow.run_console()
        # Save for next time
        if creds and creds.valid:
            with open('token.json', 'w') as token:
                token.write(creds.to_json())
        else:
            print("Authentication failed. No valid credentials returned.")
            return None

    return build('calendar', 'v3', credentials=creds)

def get_next_weekday(start_date, day_name):
    """Get the next date for a given day name from the start date."""
    weekdays = {
        # Full names
        'MONDAY': 0, 'TUESDAY': 1, 'WEDNESDAY': 2, 
        'THURSDAY': 3, 'FRIDAY': 4, 'SATURDAY': 5, 'SUNDAY': 6,
        # Abbreviated names
        'MON': 0, 'TUE': 1, 'WED': 2, 
        'THU': 3, 'FRI': 4, 'SAT': 5, 'SUN': 6
    }
    
    try:
        target_weekday = weekdays[day_name]
    except KeyError:
        print(f"Error: Unknown day format '{day_name}'. Available formats: {', '.join(weekdays.keys())}")
        return None
        
    start_weekday = start_date.weekday()
    
    days_ahead = target_weekday - start_weekday
    if days_ahead <= 0:  # Target day already happened this week
        days_ahead += 7
        
    return start_date + timedelta(days=days_ahead)

def verify_schedule_data(day_schedules):
    """Display the schedule data for verification before proceeding"""
    print("\n=== SCHEDULE VERIFICATION ===")
    print("Please verify the following schedule data before proceeding with calendar sync:")
    
    if not day_schedules:
        print("Error: No schedule data found!")
        return False, None, None
        
    # Store available days
    available_days = sorted(day_schedules.keys())
    
    # Display all schedule data
    for day in available_days:
        print(f"\n{day}:")
        periods = day_schedules[day]
        for period in periods:
            print(f"  Time: {period['time']}")
            print(f"  Course: {period['course_name']}")
            print(f"  Code: {period['course_code']}")
            print(f"  Location: {period['location']}")
            print()
    
    # Ask about event type
    print("\nEvent Type Options:")
    print("1. Recurring weekly events")
    print("2. One-time events")
    while True:
        event_type = input("Choose event type (1 or 2): ").strip()
        if event_type in ['1', '2']:
            break
        print("Please enter 1 or 2")
    
    # Ask user which days to sync
    print("\nAvailable days:", ", ".join(available_days))
    print("Options:")
    print("1. Sync all days")
    print("2. Select specific days")
    
    while True:
        choice = input("Enter your choice (1 or 2): ").strip()
        if choice == "1":
            return True, available_days, event_type
        elif choice == "2":
            print("\nEnter the days you want to sync (comma-separated)")
            print("Example: MON,TUE,FRI")
            selected_days = input("Days to sync: ").upper().split(",")
            selected_days = [day.strip() for day in selected_days]
            
            # Validate selected days
            invalid_days = [day for day in selected_days if day not in available_days]
            if invalid_days:
                print(f"Error: Invalid days selected: {', '.join(invalid_days)}")
                continue
                
            return True, selected_days, event_type
        else:
            print("Please enter 1 or 2")

def create_calendar_event(service, period_info, event_date, is_recurring=True):
    # Parse the time range
    start_time, end_time = period_info['time'].split('-')
    
    # Convert time strings to hours and minutes
    start_hour, start_minute = map(int, start_time.split(':'))
    end_hour, end_minute = map(int, end_time.split(':'))
    
    # Add 5 hours and 30 minutes to compensate for timezone conversion
    start_hour += 5
    start_minute += 30
    end_hour += 5
    end_minute += 30
    
    # Handle minute overflow
    if start_minute >= 60:
        start_hour += 1
        start_minute -= 60
    if end_minute >= 60:
        end_hour += 1
        end_minute -= 60
    
    # Handle hour overflow
    start_date = event_date
    end_date = event_date
    if start_hour >= 24:
        start_hour -= 24
        start_date = event_date + timedelta(days=1)
    if end_hour >= 24:
        end_hour -= 24
        end_date = event_date + timedelta(days=1)
    
    # Format times with adjusted values
    start_datetime = f"{start_date.strftime('%Y-%m-%d')}T{start_hour:02d}:{start_minute:02d}:00"
    end_datetime = f"{end_date.strftime('%Y-%m-%d')}T{end_hour:02d}:{end_minute:02d}:00"
    
    # Get the weekday number (0 = Monday, 6 = Sunday)
    weekday = event_date.weekday()
    weekday_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    weekday_codes = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]
    
    # Use the course name directly from period_info as it's already properly formatted with Lab suffix if needed
    course_name = period_info['course_name']
    
    # Create the event
    event = {
        'summary': course_name,
        'location': period_info['location'],
        'description': f"Course Code: {period_info['course_code']}",
        'start': {
            'dateTime': start_datetime,
            'timeZone': 'Asia/Kolkata',
        },
        'end': {
            'dateTime': end_datetime,
            'timeZone': 'Asia/Kolkata',
        }
    }
    
    # Add recurrence rule if recurring
    if is_recurring:
        event['recurrence'] = [
            f'RRULE:FREQ=WEEKLY;BYDAY={weekday_codes[weekday]}'
        ]

    print(f"  Event details:")
    print(f"    Course: {course_name}")
    print(f"    Date: {event_date.strftime('%Y-%m-%d')}")
    print(f"    Original Time: {start_time} - {end_time} IST")
    print(f"    Adjusted Time: {start_hour:02d}:{start_minute:02d} - {end_hour:02d}:{end_minute:02d} IST")
    if start_date != event_date or end_date != event_date:
        print(f"    Note: Event spans to next day")
    if is_recurring:
        print(f"    Repeats: Every {weekday_names[weekday]}")
    else:
        print(f"    One-time event on {weekday_names[weekday]}")
    print(f"    Location: {period_info['location']}")
    
    try:
        event_result = service.events().insert(calendarId='primary', body=event).execute()
        print(f"  Success! Event link: {event_result.get('htmlLink')}")
        return True
    except Exception as e:
        print(f"  Failed to create event: {str(e)}")
        return False

def sync_timetable_to_calendar(image_path, csv_path, start_date_str="2024-06-04"):
    """
    Syncs the timetable to Google Calendar
    start_date_str: Starting date in YYYY-MM-DD format
    """
    # First, process the timetable and verify the data
    print("Processing timetable and course data...")
    day_schedules = process_timetable(image_path, csv_path, return_schedules=True)
    
    proceed, selected_days, event_type = verify_schedule_data(day_schedules)
    if not proceed or not selected_days:
        return
    
    is_recurring = (event_type == '1')
    
    # Now proceed with calendar operations
    print("\nProceeding with calendar sync...")
    if is_recurring:
        print("Creating weekly recurring events")
    else:
        print("Creating one-time events")
    
    # Get the calendar service
    service = get_google_calendar_service()
    if not service:
        print("Failed to get calendar service")
        return

    # Convert start_date string to datetime object
    start_date = datetime.strptime(start_date_str, '%Y-%m-%d')
    print(f"\nEvents will be created starting from: {start_date_str}")
    events_created = 0
    
    # Process each selected day's schedule
    for day in selected_days:
        # Get the next occurrence of this weekday
        event_date = get_next_weekday(start_date, day)
        if event_date is None:
            print(f"Skipping {day}'s schedule due to invalid day format")
            continue
            
        print(f"\nProcessing {day}'s schedule...")
        
        schedule = day_schedules[day]
        for period in schedule:
            if create_calendar_event(service, period, event_date, is_recurring):
                events_created += 1

    print(f"\nSummary: Created {events_created} {'recurring' if is_recurring else 'one-time'} events for {', '.join(selected_days)}")
    if is_recurring:
        print("These events will repeat weekly on their respective days.")

if __name__ == '__main__':
    # Example usage
    image_path = "timetable.png"  # Your timetable image
    csv_path = "report_chennai.csv"  # Your course codes CSV
    start_date = "2024-06-04"  # Starting date for events
    
    sync_timetable_to_calendar(image_path, csv_path, start_date) 