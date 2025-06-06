from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import shutil
import os
from main import main as process_timetable
from datetime import datetime
import json

app = FastAPI()

# Add CORS middleware with all possible local development URLs
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
    max_age=3600,
)

# Ensure upload directories exist
os.makedirs("uploads/images", exist_ok=True)
os.makedirs("uploads/csv", exist_ok=True)

@app.get("/")
async def root():
    return {"message": "API is running"}

@app.get("/api/health")
async def health_check():
    return JSONResponse(
        status_code=200,
        content={"status": "ok", "time": datetime.now().isoformat()}
    )

@app.post("/api/process-timetable")
async def process_timetable_api(
    image: UploadFile = File(...),
    csv_file: UploadFile = File(...),
):
    if not image.filename or not csv_file.filename:
        raise HTTPException(status_code=400, detail="Both image and CSV files are required")

    try:
        # Save uploaded files with unique timestamps
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        image_path = f"uploads/images/{timestamp}_{image.filename}"
        csv_path = f"uploads/csv/{timestamp}_{csv_file.filename}"
        
        # Save files
        try:
            with open(image_path, "wb") as buffer:
                shutil.copyfileobj(image.file, buffer)
            with open(csv_path, "wb") as buffer:
                shutil.copyfileobj(csv_file.file, buffer)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to save uploaded files: {str(e)}")
        
        # Process the timetable
        try:
            result = process_timetable(image_path, csv_path, return_schedules=True)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to process timetable: {str(e)}")
        finally:
            # Clean up uploaded files
            try:
                os.remove(image_path)
                os.remove(csv_path)
            except:
                pass  # Ignore cleanup errors
        
        if not result:
            raise HTTPException(status_code=400, detail="Failed to process timetable: No results generated")
            
        return JSONResponse(
            status_code=200,
            content={"schedule": result}
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    print("Starting server at http://127.0.0.1:8000")
    uvicorn.run(
        "api:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        workers=1,
        log_level="debug"
    ) 