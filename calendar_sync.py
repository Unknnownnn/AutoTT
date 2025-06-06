from __future__ import print_function
import datetime
import os.path
import json
import sys
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from main import main as process_timetable
from datetime import datetime, timedelta
import os
from google_credentials import ensure_credentials_file

# Scope for calendar access
SCOPES = ['https://www.googleapis.com/auth/calendar.events']

def get_auth_url(credentials_dir=None):
    """Get the authorization URL and store the flow state"""
    if credentials_dir is None:
        credentials_dir = os.path.dirname(os.path.abspath(__file__))
    
    # Ensure credentials.json exists using environment variables
    if not ensure_credentials_file(credentials_dir):
        return {
            "error": "Failed to create credentials.json from environment variables",
            "success": False
        }
    
    credentials_path = os.path.join(credentials_dir, 'credentials.json')
    
    if not os.path.exists(credentials_path):
        return {
            "error": f"credentials.json not found in {credentials_dir}",
            "success": False
        }
    
    try:
        flow = InstalledAppFlow.from_client_secrets_file(
            credentials_path,
            SCOPES,
            redirect_uri='urn:ietf:wg:oauth:2.0:oob'  # Use manual copy-paste flow
        )
        # Get both the URL and state
        auth_url, state = flow.authorization_url(
            access_type='offline',
            prompt='consent'
        )
        
        # Save flow state and client config for later use
        with open(os.path.join(credentials_dir, 'flow_state.json'), 'w') as f:
            json.dump({
                'state': state,
                'client_config': flow.client_config,
                'created_at': datetime.now().isoformat()
            }, f)
        
        return {
            "success": True,
            "auth_url": auth_url
        }
    except Exception as e:
        return {
            "error": f"Failed to generate auth URL: {str(e)}",
            "success": False
        }

def complete_auth(auth_code, credentials_dir=None):
    """Complete the authorization using the provided code"""
    if credentials_dir is None:
        credentials_dir = os.path.dirname(os.path.abspath(__file__))
    
    credentials_path = os.path.join(credentials_dir, 'credentials.json')
    token_path = os.path.join(credentials_dir, 'token.json')
    state_path = os.path.join(credentials_dir, 'flow_state.json')
    
    try:
        if not os.path.exists(state_path):
            return {
                "error": "No pending authorization found. Please restart the process.",
                "success": False
            }
        
        with open(state_path, 'r') as f:
            flow_data = json.load(f)
            
        # Check if the state is too old (more than 10 minutes)
        created_at = datetime.fromisoformat(flow_data['created_at'])
        if (datetime.now() - created_at).total_seconds() > 600:
            os.remove(state_path)
            return {
                "error": "Authorization timeout. Please try again.",
                "success": False
            }
        
        # Create a new flow with the saved client config
        flow = InstalledAppFlow.from_client_config(
            flow_data['client_config'],
            SCOPES,
            redirect_uri='urn:ietf:wg:oauth:2.0:oob'
        )
        
        try:
            flow.fetch_token(code=auth_code)
            creds = flow.credentials
            
            # Save the credentials
            with open(token_path, 'w') as token:
                token.write(creds.to_json())
                
            # Clean up the state file
            os.remove(state_path)
            
            return {
                "success": True,
                "message": "Successfully authenticated with Google Calendar"
            }
        except Exception as e:
            return {
                "error": f"Failed to exchange code: {str(e)}",
                "success": False
            }
            
    except Exception as e:
        return {
            "error": str(e),
            "success": False
        }

def get_google_calendar_service(credentials_dir=None):
    """Get Google Calendar service with configurable credentials directory"""
    creds = None
    
    # Use provided credentials directory or default to script directory
    if credentials_dir is None:
        credentials_dir = os.path.dirname(os.path.abspath(__file__))
    
    token_path = os.path.join(credentials_dir, 'token.json')
    credentials_path = os.path.join(credentials_dir, 'credentials.json')

    if not os.path.exists(credentials_path):
        return {
            "error": f"credentials.json not found in {credentials_dir}",
            "success": False
        }

    # Load token if it exists
    if os.path.exists(token_path):
        try:
            creds = Credentials.from_authorized_user_file(token_path, SCOPES)
        except Exception as e:
            return {
                "error": f"Failed to load existing credentials: {str(e)}",
                "success": False
            }

    # Check if credentials need refresh or new auth
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                # Save refreshed credentials
                with open(token_path, 'w') as token:
                    token.write(creds.to_json())
            except Exception as e:
                # If refresh fails, we need new authentication
                creds = None
        
        # If no valid credentials available, return needs_auth
        if not creds:
            return {
                "error": "Authentication required",
                "success": False,
                "needs_auth": True
            }

    try:
        service = build('calendar', 'v3', credentials=creds)
        return service
    except Exception as e:
        return {
            "error": f"Failed to build calendar service: {str(e)}",
            "success": False
        }

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

def is_valid_date(date_str):
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
        return True
    except ValueError:
        return False

def sync_from_web(schedule_json_path, selected_days=None, is_recurring=True, credentials_dir=None, start_date_str=None):
    """
    Syncs schedule to calendar from web interface using saved JSON file
    Args:
        schedule_json_path: Path to the JSON file containing schedule data
        selected_days: List of days to sync (if None, syncs all days)
        is_recurring: Whether to create recurring events
        credentials_dir: Directory containing Google Calendar credentials
        start_date_str: Start date in YYYY-MM-DD format (defaults to today)
    """
    try:
        # Read the schedule from the JSON file
        with open(schedule_json_path, 'r') as f:
            day_schedules = json.load(f)

        if not day_schedules:
            return {"error": "No schedule data found", "success": False}

        # Get available days
        available_days = sorted(day_schedules.keys())
        if not available_days:
            return {"error": "No days found in schedule", "success": False}

        # Validate selected days
        if selected_days:
            invalid_days = [day for day in selected_days if day not in available_days]
            if invalid_days:
                return {
                    "error": f"Invalid days selected: {', '.join(invalid_days)}",
                    "success": False,
                    "available_days": available_days
                }
        else:
            selected_days = available_days

        # Get the calendar service
        service = get_google_calendar_service(credentials_dir)
        if isinstance(service, dict):  # Error occurred
            if service.get('needs_auth'):
                # Get auth URL if authentication is needed
                auth_result = get_auth_url(credentials_dir)
                if not auth_result['success']:
                    return auth_result
                return {
                    "success": False,
                    "needs_auth": True,
                    "auth_url": auth_result['auth_url']
                }
            return service

        # Set start date
        if start_date_str and is_valid_date(start_date_str):
            start_date = datetime.strptime(start_date_str, '%Y-%m-%d')
        else:
            start_date = datetime.now()

        events_created = 0
        summary = []
        errors = []

        # Process each selected day's schedule
        for day in selected_days:
            if day not in day_schedules:
                continue

            # Get the next occurrence of this weekday
            event_date = get_next_weekday(start_date, day)
            if event_date is None:
                errors.append(f"Could not determine date for {day}")
                continue

            schedule = day_schedules[day]
            for period in schedule:
                if create_calendar_event(service, period, event_date, is_recurring):
                    events_created += 1
                    summary.append({
                        "day": day,
                        "course": period["course_name"],
                        "time": period["time"],
                        "location": period["location"]
                    })
                else:
                    errors.append(f"Failed to create event for {period['course_name']} on {day}")

        response = {
            "success": True,
            "events_created": events_created,
            "summary": summary,
            "message": f"Created {events_created} {'recurring' if is_recurring else 'one-time'} events",
            "available_days": available_days
        }
        
        if errors:
            response["warnings"] = errors

        return response

    except Exception as e:
        return {
            "error": str(e),
            "success": False
        }

def authenticate_in_new_window(credentials_dir=None):
    """Start authentication in a headless environment"""
    if credentials_dir is None:
        credentials_dir = os.path.dirname(os.path.abspath(__file__))
    
    credentials_path = os.path.join(credentials_dir, 'credentials.json')
    token_path = os.path.join(credentials_dir, 'token.json')

    if not os.path.exists(credentials_path):
        return {
            "error": f"credentials.json not found in {credentials_dir}",
            "success": False
        }

    try:
        flow = InstalledAppFlow.from_client_secrets_file(
            credentials_path,
            SCOPES,
            redirect_uri='urn:ietf:wg:oauth:2.0:oob'
        )
        
        # Get the authorization URL
        auth_url, _ = flow.authorization_url(
            access_type='offline',
            prompt='consent'
        )
        
        return {
            "success": True,
            "auth_url": auth_url,
            "message": "Please visit this URL to authorize access to your Google Calendar"
        }
        
    except Exception as e:
        return {
            "error": f"Failed to prepare authentication: {str(e)}",
            "success": False
        }

def complete_auth_headless(auth_code, credentials_dir=None):
    """Complete the authorization using the provided code in a headless environment"""
    if credentials_dir is None:
        credentials_dir = os.path.dirname(os.path.abspath(__file__))
    
    credentials_path = os.path.join(credentials_dir, 'credentials.json')
    token_path = os.path.join(credentials_dir, 'token.json')
    
    try:
        flow = InstalledAppFlow.from_client_secrets_file(
            credentials_path,
            SCOPES,
            redirect_uri='urn:ietf:wg:oauth:2.0:oob'
        )
        
        try:
            flow.fetch_token(code=auth_code)
            creds = flow.credentials
            
            # Save the credentials
            with open(token_path, 'w') as token:
                token.write(creds.to_json())
            
            return {
                "success": True,
                "message": "Successfully authenticated with Google Calendar"
            }
        except Exception as e:
            return {
                "error": f"Failed to exchange code: {str(e)}",
                "success": False
            }
            
    except Exception as e:
        return {
            "error": str(e),
            "success": False
        }

def get_current_user_info(credentials_dir=None):
    """Get information about the currently authenticated user"""
    if credentials_dir is None:
        credentials_dir = os.path.dirname(os.path.abspath(__file__))
    
    token_path = os.path.join(credentials_dir, 'token.json')
    print(f"Checking for token file at: {token_path}")
    
    if not os.path.exists(token_path):
        print(f"Token file not found at: {token_path}")
        return {
            "success": False,
            "authenticated": False,
            "message": "No user currently logged in"
        }
    
    try:
        print(f"Loading credentials from: {token_path}")
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)
        print(f"Credentials loaded. Valid: {creds.valid}, Expired: {creds.expired if hasattr(creds, 'expired') else 'N/A'}")
        
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                try:
                    print("Attempting to refresh expired credentials")
                    creds.refresh(Request())
                    # Save refreshed credentials
                    with open(token_path, 'w') as token:
                        token.write(creds.to_json())
                    print("Successfully refreshed credentials")
                except Exception as e:
                    print(f"Failed to refresh credentials: {str(e)}")
                    return {
                        "success": False,
                        "authenticated": False,
                        "message": "Credentials expired and refresh failed"
                    }
            else:
                print("Invalid credentials and cannot refresh")
                return {
                    "success": False,
                    "authenticated": False,
                    "message": "Invalid credentials"
                }
        
        # Get user info from the calendar service
        print("Building calendar service")
        service = build('calendar', 'v3', credentials=creds)
        print("Getting calendar list")
        calendar_list = service.calendarList().get(calendarId='primary').execute()
        print(f"Got calendar info for: {calendar_list.get('id', 'Unknown')}")
        
        return {
            "success": True,
            "authenticated": True,
            "email": calendar_list.get('id', 'Unknown'),  # This is the user's email
            "name": calendar_list.get('summary', 'Unknown')  # This is usually the user's name
        }
    except Exception as e:
        print(f"Error in get_current_user_info: {str(e)}")
        return {
            "success": False,
            "authenticated": False,
            "message": str(e)
        }

def logout_user(credentials_dir=None):
    """Log out the current user by removing the token file"""
    if credentials_dir is None:
        credentials_dir = os.path.dirname(os.path.abspath(__file__))
    
    token_path = os.path.join(credentials_dir, 'token.json')
    
    try:
        if os.path.exists(token_path):
            os.remove(token_path)
            return {
                "success": True,
                "message": "Successfully logged out"
            }
        return {
            "success": True,
            "message": "No user was logged in"
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

if __name__ == '__main__':
    # Check if running in auth completion mode
    if len(sys.argv) > 1 and sys.argv[1] == '--auth':
        if len(sys.argv) < 3:
            print(json.dumps({
                "error": "Missing credentials directory",
                "success": False
            }))
            sys.exit(1)
            
        credentials_dir = sys.argv[2]
        result = authenticate_in_new_window(credentials_dir)
        print(json.dumps(result))
        sys.exit(0)
    
    # Check if running in auth completion mode
    if len(sys.argv) > 1 and sys.argv[1] == '--complete-auth':
        if len(sys.argv) < 4:
            print(json.dumps({
                "error": "Missing auth code or credentials directory",
                "success": False
            }))
            sys.exit(1)
            
        auth_code = sys.argv[2]
        credentials_dir = sys.argv[3]
        result = complete_auth_headless(auth_code, credentials_dir)
        print(json.dumps(result))
        sys.exit(0)
    
    # Check if script is being run with a JSON file path (web mode)
    if len(sys.argv) > 1 and sys.argv[1].endswith('.json'):
        # Parse additional arguments if provided
        selected_days = sys.argv[2].split(',') if len(sys.argv) > 2 else None
        is_recurring = sys.argv[3].lower() == 'true' if len(sys.argv) > 3 else True
        credentials_dir = sys.argv[4] if len(sys.argv) > 4 else None
        start_date = sys.argv[5] if len(sys.argv) > 5 else None
        
        # Web mode
        result = sync_from_web(
            sys.argv[1], 
            selected_days=selected_days,
            is_recurring=is_recurring,
            credentials_dir=credentials_dir,
            start_date_str=start_date
        )
        print(json.dumps(result))
        sys.exit(0)
    
    # Check if running in user info mode
    if len(sys.argv) > 1 and sys.argv[1] == '--user-info':
        if len(sys.argv) > 2:
            credentials_dir = sys.argv[2]
            result = get_current_user_info(credentials_dir)
        else:
            result = get_current_user_info()
        print(json.dumps(result))
        sys.exit(0)
    
    # Check if running in logout mode
    if len(sys.argv) > 1 and sys.argv[1] == '--logout':
        if len(sys.argv) > 2:
            credentials_dir = sys.argv[2]
            result = logout_user(credentials_dir)
        else:
            result = logout_user()
        print(json.dumps(result))
        sys.exit(0)
    
    # Interactive mode (only if no specific mode is specified)
    image_path = input("Enter timetable image path: ").strip()
    while not os.path.exists(image_path):
        print("File not found. Please enter a valid image path.")
        image_path = input("Enter timetable image path: ").strip()

    csv_path = input("Enter course names CSV path: ").strip()
    while not os.path.exists(csv_path):
        print("File not found. Please enter a valid CSV path.")
        csv_path = input("Enter course names CSV path: ").strip()

    start_date = input("Enter start date (YYYY-MM-DD): ").strip()
    while not is_valid_date(start_date):
        print("Invalid date format. Please enter in YYYY-MM-DD format.")
        start_date = input("Enter start date (YYYY-MM-DD): ").strip()

    sync_timetable_to_calendar(image_path, csv_path, start_date)