import cv2
import numpy as np
import pytesseract
from PIL import Image
import re
import csv
import argparse
import os


def parse_arguments():
    parser = argparse.ArgumentParser(description='Process timetable image and course codes.')
    parser.add_argument('--image', '-i', 
                      required=True,
                      help='Path to the timetable image file')
    parser.add_argument('--csv', '-c',
                      required=True,
                      help='Path to the CSV file containing course codes')
    return parser.parse_args()

def normalize_period(period):
    if not period:
        return ""
    period = period.replace('\n', '')
    period = period.replace('/', '')
    period = period.replace('|', '')
    period = period.replace('‘', '')
    period = period.replace('’', '')
    period = period.replace('`', '')
    period = period.replace('(', '')
    period = period.replace(')', '')
    period = period.strip()
    period = re.sub(r'\s+', '', period)
    return period

def preprocess_image(image_path):
    print("Preprocessing image...")
    image = cv2.imread(image_path)
    if image is None:
        raise FileNotFoundError(f"Could not load image at {image_path}")
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)
    print("Image preprocessing complete.")
    return image, gray, thresh

def get_cell_regions(thresh):
    print("Detecting cell regions...")
    kernel = np.ones((3, 3), np.uint8)
    dilated = cv2.dilate(thresh, kernel, iterations=2)
    contours, _ = cv2.findContours(
        dilated, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE
    )
    cells = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        if 30 < w < 300 and 20 < h < 100:
            cells.append((x, y, w, h))
    print(f"Found {len(cells)} cells.")
    return cells

def extract_text_from_cells(image, cells):
    print("Starting text extraction with pytesseract...")
    total_cells = len(cells)
    matrix = []
    current_row = []
    last_y = -1
    processed_cells = 0
    cells = sorted(cells, key=lambda x: (x[1], x[0]))
    for (x, y, w, h) in cells:
        processed_cells += 1
        if processed_cells%30==0:
            print(f"Processing cell {processed_cells}/{total_cells} at position ({x}, {y})...")
        if last_y != -1 and abs(y - last_y) > 20:
            if current_row:
                matrix.append(current_row)
                current_row = []
        cell_img = image[y:y+h, x:x+w]
        pil_img = Image.fromarray(cv2.cvtColor(cell_img, cv2.COLOR_BGR2RGB))
        text = pytesseract.image_to_string(pil_img, config='--psm 6').strip()
        current_row.append(text if text else "")
        last_y = y
    if current_row:
        matrix.append(current_row)
    print("Text extraction complete.")
    print("\nExtracted Matrix:")
    for row in matrix:
        print(row)
    return matrix

def map_periods_to_timings(matrix):
    print("Mapping periods to timings...")
    
    if len(matrix) < 2:
        raise ValueError("Matrix does not have enough rows. Expected at least 2 rows for timings and data.")
    
    # Extract theory timings
    theory_timings = []
    print("Extracting theory timings...")
    start_times = matrix[0][2:]
    end_times = matrix[1][1:]
    for i in range(len(start_times)):
        if i >= len(end_times):
            print(f"Warning: No end time for start time at index {i}. Skipping.")
            continue
        start = start_times[i]
        end = end_times[i]
        if start.lower() != "lunch" and end:
            theory_timings.append(f"{start}-{end}")
        else:
            print(f"Skipping time slot at index {i}: Start={start}, End={end}")
    
    # Correct the OCR error in theory timings
    print(f"Original Theory Timings: {theory_timings}")
    theory_timings[3] = "10:45-11:35"  # Fix the fourth slot
    print(f"Corrected Theory Timings: {theory_timings}")
    
    # Hardcode lab timings since OCR failed to extract them
    lab_timings = [
        "08:00-08:50", "08:50-09:40", "09:50-10:40", "10:40-11:30", 
        "11:40-12:30", "12:30-13:20", "14:00-14:50", "14:50-15:40", 
        "15:50-16:40", "16:40-17:30", "17:40-18:30", "18:30-19:20"
    ]
    print(f"Lab Timings (hardcoded): {lab_timings}")
    
    period_pattern = r'[A-Z]+\d+-[A-Z]{4}\d{3}[A-Z]-[A-Z]{2,3}-AB\d-\d{3}-?[A-Z]*'
    
    # Process each day
    day_schedules = {}
    current_day = None
    
    for row in matrix[2:]:
        if len(row) < 2:
            print(f"Skipping row due to insufficient columns: {row}")
            continue
        
        # Check if the first element is THEORY or LAB (continuation of previous day)
        if row[0] in ["THEORY", "LAB"]:
            if current_day is None:
                print(f"Error: No day specified before encountering {row[0]} row: {row}")
                continue
            current_type = row[0]
            schedule = row[1:]
            day = current_day
        # Check if the second element is THEORY or LAB (new day)
        elif row[1] in ["THEORY", "LAB"]:
            current_type = row[1]
            day = row[0]
            current_day = day  # Update the current day
            schedule = row[2:]
        else:
            print(f"Skipping row due to missing THEORY/LAB label: {row}")
            continue
        
        print(f"Processing schedule for {day} ({current_type}): {schedule}")
        
        # Choose timings based on type
        timings = theory_timings if current_type == "THEORY" else lab_timings
        
        # Map each period to its timing
        day_schedule = day_schedules.get(day, [])  # Append to existing schedule for this day
        timing_index = 0
        for period in schedule:
            if timing_index >= len(timings):
                print(f"Warning: Ran out of timings for {day}. Stopping at period {period}.")
                break
            if period and period.lower() != "lunch":
                # Check if the period matches the expected pattern
                cleaned_period = normalize_period(period)

                if re.search(period_pattern, cleaned_period):
                    print(f"Assigning {cleaned_period} to time slot {timings[timing_index]}")
                    day_schedule.append((cleaned_period, timings[timing_index]))
                else:
                    print(f"Period {period} (cleaned: {cleaned_period}) does not match the expected pattern. Skipping.")

                timing_index += 1
            else:
                print(f"Skipping period in {day}: {period}")
        
        day_schedules[day] = day_schedule
    
    print("Mapping complete.")
    return day_schedules

def get_location(period_code):
    # Extract location from codes like F2-BMAT202L-TH-AB3-206-ALL or L1-BMAT202P-LO-AB2-301A-ALL
    match = re.search(r'([A-Z]+\d-\d{3}A?)(?=-[A-Z]*$)', period_code)
    if match:
        return match.group(1)
    return "Unknown"

def get_course_name(course_code, course_map):
    # Extract complete course code including L, E, P suffixes
    match = re.search(r'[A-Z]{4}\d{3}[LEP]?', course_code)
    if match:
        extracted_code = match.group()  # Use complete extracted code
        if extracted_code in course_map:
            return course_map[extracted_code]
        else:
            # Try without the suffix if the exact match wasn't found
            base_code = re.match(r'[A-Z]{4}\d{3}', extracted_code).group()
            if base_code in course_map:
                return course_map[base_code]
    return course_code

def extract_course_code(period_code):
    # Extract complete course code including L, E, P suffixes
    match = re.search(r'[A-Z]{4}\d{3}[LEP]?', period_code)
    if match:
        return match.group()
    return None

def display_day_schedules(day_schedules, course_map):
    if not course_map:
        print("\nWarning: No course mappings available. Displaying original codes.")
        return
    
    print("\nDetailed Day-wise Schedules:")
    all_periods = {}
    
    for day, schedule in sorted(day_schedules.items()):
        print(f"\n{day}:")
        day_periods = []
        
        # First create all period info objects
        for period_code, timing in schedule:
            period_info = {
                'time': timing,
                'course_code': period_code,
                'actual_code': extract_course_code(period_code),
                'course_name': get_course_name(period_code, course_map),
                'location': get_location(period_code),
                'start_time': timing.split('-')[0],
                'end_time': timing.split('-')[1]
            }
            day_periods.append(period_info)
        
        # Sort periods by time
        day_periods.sort(key=lambda x: x['start_time'])
        
        # Merge consecutive lab periods
        merged_periods = []
        i = 0
        while i < len(day_periods):
            current = day_periods[i]
            
            # Check if this is a lab period (ends with P or E)
            if current['actual_code'] and (current['actual_code'].endswith('P') or current['actual_code'].endswith('E')):
                # Look ahead for consecutive lab periods of the same course
                merged_end_time = current['end_time']
                last_merged_idx = i
                
                for j in range(i + 1, len(day_periods)):
                    next_period = day_periods[j]
                    if (next_period['actual_code'] == current['actual_code'] and 
                        next_period['start_time'] == merged_end_time):
                        merged_end_time = next_period['end_time']
                        last_merged_idx = j
                    else:
                        break
                
                if last_merged_idx > i:
                    # Create merged period
                    merged_period = current.copy()
                    merged_period['time'] = f"{current['start_time']}-{merged_end_time}"
                    # Add "Lab" to course name for merged lab periods
                    if not merged_period['course_name'].endswith('Lab'):
                        merged_period['course_name'] += ' Lab'
                    merged_periods.append(merged_period)
                    i = last_merged_idx + 1
                    continue
            
            merged_periods.append(current)
            i += 1
        
        all_periods[day] = merged_periods
        
        # Display periods in a structured format
        for period in merged_periods:
            print(f"  Time: {period['time']}")
            print(f"  Course: {period['course_name']}")
            print(f"  Code: {period['course_code']}")
            print(f"  Location: {period['location']}")
            print()  # Empty line between periods
    
    return all_periods

def read_course_codes(csv_path):
    print("Reading course codes from CSV file...")
    try:
        course_map = {}
        seen_codes = set()  # Track seen codes to take only first occurrence
        with open(csv_path, 'r') as file:
            csv_reader = csv.reader(file)
            next(csv_reader)  # Skip the header row
            for row in csv_reader:
                if len(row) >= 2:  
                    code = row[0].strip().upper()  # Keep the complete code including suffixes
                    name = row[1].strip()          
                    if code and name:
                        # Store both the full code and the base code (without suffix)
                        base_code = re.match(r'[A-Z]{4}\d{3}', code)
                        if base_code and base_code.group() not in seen_codes:
                            base_code = base_code.group()
                            course_map[base_code] = name
                            seen_codes.add(base_code)
                            # Also store the full code if it has a suffix
                            if len(code) > len(base_code):
                                course_map[code] = name
        
        print(f"\nSuccessfully loaded {len(course_map)} unique course mappings")
        return course_map
    except Exception as e:
        print(f"Error reading CSV file: {str(e)}")
        print("Make sure your CSV file has at least two columns:")
        print("Column 1: Course codes (e.g., BCSE204L, BCSE203E, BCSE308P)")
        print("Column 2: Course names")
        return {}

def main(image_path, csv_path, return_schedules=False):
    course_map = read_course_codes(csv_path)
    image, gray, thresh = preprocess_image(image_path)
    cells = get_cell_regions(thresh)
    if not cells:
        print("No cells detected in the table")
        return None if return_schedules else None
    matrix = extract_text_from_cells(image, cells)
    day_schedules = map_periods_to_timings(matrix)
    result = display_day_schedules(day_schedules, course_map)
    return result if return_schedules else None

if __name__ == "__main__":
    args = parse_arguments()
    
    # Verify files exist
    if not os.path.exists(args.image):
        print(f"Error: Image file not found at {args.image}")
        exit(1)
    if not os.path.exists(args.csv):
        print(f"Error: CSV file not found at {args.csv}")
        exit(1)
        
    try:
        main(args.image, args.csv)
    except Exception as e:
        print(f"Error occurred: {str(e)}")
        exit(1)