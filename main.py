import cv2
import numpy as np
import pytesseract
from PIL import Image
import re
import csv
import argparse
import os
import sys
import json
import locale

# Set UTF-8 encoding for stdout
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8') if hasattr(sys.stdout, 'reconfigure') else None

# Modify print function to handle encoding errors
def safe_print(*args, **kwargs):
    try:
        print(*args, **kwargs)
    except UnicodeEncodeError:
        # Try with ASCII if UTF-8 fails
        try:
            print(*[str(arg).encode('ascii', 'replace').decode() for arg in args], **kwargs)
        except:
            # Last resort: skip problematic characters
            print(*[str(arg).encode('ascii', 'ignore').decode() for arg in args], **kwargs)

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
        
    # Get image dimensions
    height, width = image.shape[:2]
    print(f"Original image dimensions: {width}x{height}")
    
    # Convert to HSV for better color detection
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    
    # Define yellow and green color ranges in HSV
    yellow_lower = np.array([20, 50, 180])
    yellow_upper = np.array([35, 255, 255])
    green_lower = np.array([35, 50, 180])
    green_upper = np.array([85, 255, 255])
    
    # Create masks for yellow and green
    yellow_mask = cv2.inRange(hsv, yellow_lower, yellow_upper)
    green_mask = cv2.inRange(hsv, green_lower, green_upper)
    
    # Combine masks
    highlight_mask = cv2.bitwise_or(yellow_mask, green_mask)
    
    # Convert original image to grayscale for OCR
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    # Create binary image for structure detection
    _, binary = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)
    
    print("Image preprocessing complete.")
    return image, gray, highlight_mask, binary

def get_cell_regions(mask, binary):
    print("Detecting cell regions...")
    
    # Get image dimensions
    height, width = mask.shape[:2]
    
    # Create a copy of the original image for visualization
    debug_image = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)
    
    # Find contours in the highlight mask (yellow/green cells)
    contours, _ = cv2.findContours(
        mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    
    # Get all cells with their coordinates
    all_cells = []
    min_area = (width * height) * 0.0005
    max_area = (width * height) * 0.02
    
    print(f"\nArea thresholds: min={min_area:.2f}, max={max_area:.2f}")
    
    for contour in contours:
        area = cv2.contourArea(contour)
        if min_area < area < max_area:
            x, y, w, h = cv2.boundingRect(contour)
            padding = 2
            x = max(0, x - padding)
            y = max(0, y - padding)
            w = min(width - x, w + 2*padding)
            h = min(height - y, h + 2*padding)
            all_cells.append((x, y, w, h))
            # Draw rectangle on debug image
            cv2.rectangle(debug_image, (x, y), (x+w, y+h), (0, 255, 0), 2)
    
    # Sort cells by y-coordinate first to group rows
    all_cells.sort(key=lambda cell: cell[1])
    
    # Find the start of content (after blue header)
    if len(all_cells) > 0:
        content_start_y = all_cells[0][1]  # Y coordinate of first highlighted cell
        print(f"Content starts at y={content_start_y}")
        # Draw content start line
        cv2.line(debug_image, (0, content_start_y), (width, content_start_y), (255, 0, 0), 2)
    else:
        print("No cells detected!")
        return [], []
    
    # Group cells into day rows (each day has theory and lab row)
    day_rows = []
    current_theory_row = []
    current_lab_row = []
    last_y = None
    y_threshold = height * 0.03  # 3% of image height for row grouping
    print(f"Y-coordinate threshold for row grouping: {y_threshold:.2f}")
    
    for cell in all_cells:
        x, y, w, h = cell
        # Skip cells above content start
        if y < content_start_y:
            continue
            
        if last_y is None:
            current_theory_row.append(cell)
            print(f"\nStarting new theory row at y={y}")
        else:
            y_diff = abs(y - last_y)
            print(f"Y difference: {y_diff:.2f} (threshold: {y_threshold:.2f})")
            if y_diff < y_threshold:
                # Same row
                if len(current_lab_row) > 0:
                    current_lab_row.append(cell)
                    print(f"Adding to lab row: ({x}, {y})")
                else:
                    current_theory_row.append(cell)
                    print(f"Adding to theory row: ({x}, {y})")
            else:
                # New row
                if len(current_theory_row) > 0 and len(current_lab_row) == 0:
                    # Moving to lab row
                    current_lab_row.append(cell)
                    print(f"\nStarting new lab row at y={y}")
                else:
                    # Complete day, store and reset
                    if current_theory_row and current_lab_row:
                        # Sort each row by x-coordinate
                        current_theory_row.sort(key=lambda c: c[0])
                        current_lab_row.sort(key=lambda c: c[0])
                        day_rows.append((current_theory_row[:12], current_lab_row[:12]))
                        print(f"\nCompleted day {len(day_rows)}:")
                        print(f"Theory cells: {len(current_theory_row[:12])}")
                        print(f"Lab cells: {len(current_lab_row[:12])}")
                    # Start new theory row
                    current_theory_row = [cell]
                    current_lab_row = []
                    print(f"\nStarting new theory row at y={y}")
        last_y = y
    
    # Add the last day if complete
    if current_theory_row and current_lab_row:
        current_theory_row.sort(key=lambda c: c[0])
        current_lab_row.sort(key=lambda c: c[0])
        day_rows.append((current_theory_row[:12], current_lab_row[:12]))
        print(f"\nCompleted final day {len(day_rows)}:")
        print(f"Theory cells: {len(current_theory_row[:12])}")
        print(f"Lab cells: {len(current_lab_row[:12])}")
    
    # Save debug image
    cv2.imwrite('detected_regions.png', debug_image)
    print("\nSaved visualization to 'detected_regions.png'")
    
    # Flatten the cells while preserving theory/lab information
    processed_cells = []
    for day_index, (theory_row, lab_row) in enumerate(day_rows, 1):
        print(f"\nDay {day_index}:")
        # Add theory cells
        print("Theory cells x-coordinates:", [x for x, _, _, _ in theory_row])
        for cell in theory_row:
            processed_cells.append(('theory', cell))
        # Add lab cells
        print("Lab cells x-coordinates:", [x for x, _, _, _ in lab_row])
        for cell in lab_row:
            processed_cells.append(('lab', cell))
    
    print(f"\nFound {len(processed_cells)} cells in {len(day_rows)} days")
    return processed_cells, []  # Empty timing cells as we're using hardcoded timings

def extract_text_from_cells(image, cells, timing_cells=None):
    print("Starting text extraction from cells...")
    matrix = []
    timings = {'theory': [], 'lab': []}
    
    # Then extract course data
    for (cell_type, (x, y, w, h)) in cells:
        # Extract the cell image with strict padding
        padding = 2  # Reduced padding to stay within borders
        x_start = max(0, x - padding)
        y_start = max(0, y - padding)
        x_end = min(image.shape[1], x + w + padding)
        y_end = min(image.shape[0], y + h + padding)
        cell_img = image[y_start:y_end, x_start:x_end]
        
        # Convert to PIL Image
        pil_img = Image.fromarray(cv2.cvtColor(cell_img, cv2.COLOR_BGR2RGB))
        
        # Scale up for better OCR
        scale_factor = 3.0  # Increased scale factor for better recognition
        new_size = (int(cell_img.shape[1] * scale_factor), int(cell_img.shape[0] * scale_factor))
        pil_img = pil_img.resize(new_size, Image.Resampling.LANCZOS)
        
        # Try different PSM modes with specific configurations
        psm_modes = [
            (7, '--psm 7 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'),  # Single line with limited chars
            (6, '--psm 6'),  # Uniform block of text
            (3, '--psm 3')   # Fully automatic
        ]
        best_text = ""
        max_confidence = 0
        
        for psm, config in psm_modes:
            # Extract text with confidence info
            data = pytesseract.image_to_data(
                pil_img,
                config=config,
                output_type=pytesseract.Output.DICT
            )
            
            # Combine all text with confidence above threshold
            text_parts = []
            avg_confidence = 0
            valid_parts = 0
            
            for i in range(len(data['text'])):
                if int(data['conf'][i]) > 25:  # Lower confidence threshold for short texts
                    text = data['text'][i].strip()
                    if text:
                        text_parts.append(text)
                        avg_confidence += int(data['conf'][i])
                        valid_parts += 1
            
            if valid_parts > 0:
                avg_confidence /= valid_parts
                text = ' '.join(text_parts)
                
                # Special handling for short codes
                if re.match(r'^[A-Z]\d+$|^[A-Z]{2}\d+$', text):  # Matches A1, B2, TG1, etc.
                    avg_confidence += 10  # Boost confidence for valid short codes
                
                if avg_confidence > max_confidence:
                    max_confidence = avg_confidence
                    best_text = text
        
        # Clean up the extracted text
        best_text = best_text.strip()
        best_text = re.sub(r'\s+', ' ', best_text)  # Normalize spaces
        
        # Always add the cell to matrix, even if empty
        matrix.append((best_text, (x, y, w, h)))
        print(f"Extracted text from cell at ({x}, {y}): '{best_text}' ({cell_type})")
    
    return matrix, timings

def map_periods_to_timings(matrix, timings):
    # Hardcoded structure
    days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
    
    # Hardcoded timing slots (12 slots excluding lunch)
    theory_slots = [
        "08:00-08:50", "08:55-09:45", "09:50-10:40", "10:45-11:35",
        "11:40-12:30", "12:35-13:25", "14:00-14:50", "14:55-15:45",
        "15:50-16:40", "16:45-17:35", "17:40-18:30", "18:35-19:25"
    ]
    
    lab_slots = [
        "08:00-08:50", "08:50-09:40", "09:50-10:40", "10:40-11:30",
        "11:40-12:30", "12:30-13:20", "14:00-14:50", "14:50-15:40",
        "15:50-16:40", "16:40-17:30", "17:40-18:30", "18:30-19:20"
    ]
    
    print("\nStarting period mapping:")
    print("------------------------")
    
    # Initialize schedules
    day_schedules = {day: [] for day in days}
    
    # Process cells in order (they're already organized by day and type)
    current_day_index = 0
    current_slot_index = 0
    current_type = 'theory'
    
    print(f"\nInitial state: Day={days[current_day_index]}, Type={current_type}, Slot={current_slot_index}")
    
    for cell_text, coords in matrix:
        print(f"\nProcessing cell: '{cell_text}'")
        print(f"Current state: Day={days[current_day_index]}, Type={current_type}, Slot={current_slot_index}")
        
        # Skip if we've processed all days
        if current_day_index >= len(days):
            print("Reached end of days, stopping")
            break
            
        day = days[current_day_index]
        slots = lab_slots if current_type == 'lab' else theory_slots
        timing = slots[current_slot_index]
        
        # Clean and validate the cell text
        cell_text = normalize_period(cell_text) if cell_text else ""
        
        # Always map the cell, even if empty or invalid
        if cell_text and re.search(r'[A-Z]+\d+-[A-Z]{4}\d{3}[A-Z]?-[A-Z]{2,3}-AB\d-\d{3}(?:-[A-Z]+)?', cell_text):
            print(f"✓ Valid period: {cell_text}")
            day_schedules[day].append((cell_text, timing))
        else:
            print(f"ℹ Skipping invalid/empty text: '{cell_text}' but counting slot")
        
        # Always move to next slot
        current_slot_index += 1
        if current_slot_index >= 12:
            current_slot_index = 0
            if current_type == 'theory':
                current_type = 'lab'
                print("Switching to lab row")
            else:
                current_type = 'theory'
                current_day_index += 1
                if current_day_index < len(days):
                    print(f"Moving to next day: {days[current_day_index]}")
    
    print("\nMapping complete!")
    print("----------------")
    for day in days:
        print(f"\n{day}:")
        for period, timing in day_schedules[day]:
            print(f"  {timing}: {period}")
    
    return day_schedules

def get_location(period_code):
    # Extract location from codes like L5-BCSE301P-LO-AB1-205B-ALL or F2-BMAT202L-TH-AB3-206-ALL
    # First try to match the full location pattern (AB1-205B)
    match = re.search(r'(AB\d-\d{3}[A-Z]?)', period_code)
    if match:
        return match.group(1)
    
    # If that fails, try to match just the room number pattern
    match = re.search(r'(\d{3}[A-Z]?)(?=-[A-Z]+$)', period_code)
    if match:
        # Try to find the block
        block_match = re.search(r'-(AB\d)-', period_code)
        if block_match:
            return f"{block_match.group(1)}-{match.group(1)}"
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
        safe_print("\nWarning: No course mappings available. Displaying original codes.")
        return {}
    
    safe_print("\nDetailed Day-wise Schedules:")
    all_periods = {}
    
    for day, schedule in sorted(day_schedules.items()):
        safe_print(f"\n{day}:")
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
        
        # Ensure we store an empty array even if there are no periods
        all_periods[day] = merged_periods
        
        # Display periods in a structured format
        for period in merged_periods:
            safe_print(f"  Time: {period['time']}")
            safe_print(f"  Course: {period['course_name']}")
            safe_print(f"  Code: {period['course_code']}")
            safe_print(f"  Location: {period['location']}")
            safe_print()  # Empty line between periods
    
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

def main(image_path=None, csv_path=None, return_schedules=False):
    try:
        # Process image and get regions
        image, gray, mask, binary = preprocess_image(image_path)
        cells, timing_cells = get_cell_regions(mask, binary)
        
        if not cells:
            raise ValueError("No cells detected in the table")
            
        # Extract text and map periods
        matrix, timings = extract_text_from_cells(image, cells, timing_cells)
        day_schedules = map_periods_to_timings(matrix, timings)
        course_map = read_course_codes(csv_path)
        
        # Format and return or display the schedule
        result = display_day_schedules(day_schedules, course_map)
        if return_schedules:
            # Add an extra check to ensure all values are arrays
            formatted_result = {
                day: (periods if isinstance(periods, list) else [])
                for day, periods in result.items()
            }
            print(json.dumps(formatted_result))
            return formatted_result
        return None
    except Exception as e:
        error_msg = str(e)
        if return_schedules:
            print(json.dumps({"error": error_msg}))
        else:
            print(f"Error: {error_msg}", file=sys.stderr)
        return None

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Process timetable image and course code CSV")
    parser.add_argument("image_path", help="Path to the timetable image")
    parser.add_argument("csv_path", help="Path to the course codes CSV file")
    parser.add_argument("--return-schedules", action="store_true", help="Return schedules as JSON")
    args = parser.parse_args()

    main(args.image_path, args.csv_path, args.return_schedules)
