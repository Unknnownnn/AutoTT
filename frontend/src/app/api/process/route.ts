import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join, resolve } from 'path';
import os from 'os';
import fs from 'fs';

// Helper function to get Python command based on OS
function getPythonCommand() {
  // Check if python3 is available (common on Linux)
  try {
    spawn('python3', ['--version']);
    return 'python3';
  } catch {
    // Fallback to python (common on Windows)
    return 'python';
  }
}

export async function POST(req: Request) {
  let tempDir = '';
  const pythonCommand = getPythonCommand();
  
  try {
    const formData = await req.formData();
    const image = formData.get('image') as File;
    const csvFile = formData.get('csv_file') as File;
    const syncToCalendar = formData.get('sync_to_calendar') === 'true';
    const selectedDays = formData.get('selected_days') as string;
    const isRecurring = formData.get('is_recurring') === 'true';
    const startDate = formData.get('start_date') as string;

    if (!image || !csvFile) {
      return NextResponse.json(
        { error: 'Both image and CSV files are required' },
        { status: 400 }
      );
    }

    // Create temp directory using a timestamp to avoid conflicts
    const timestamp = Date.now();
    tempDir = join(os.tmpdir(), `autott-${timestamp}`);
    const imagePath = join(tempDir, image.name);
    const csvPath = join(tempDir, csvFile.name);
    const schedulePath = join(tempDir, 'schedule.json');
    
    // Get the absolute project root directory
    const projectRoot = resolve(process.cwd().includes('frontend') 
      ? join(process.cwd(), '..') 
      : process.cwd());

    console.log('Project root:', projectRoot);
    console.log('Python command:', pythonCommand);
    console.log('Current working directory:', process.cwd());
    console.log('Temp directory:', tempDir);

    // Verify Tesseract installation
    try {
      const tesseractCheck = spawn('tesseract', ['--version']);
      tesseractCheck.on('error', (error) => {
        console.error('Tesseract check error:', error);
        throw new Error('Tesseract is not properly installed');
      });
      
      await new Promise((resolve, reject) => {
        let versionInfo = '';
        tesseractCheck.stdout.on('data', (data) => {
          versionInfo += data.toString();
        });
        tesseractCheck.on('close', (code) => {
          if (code === 0) {
            console.log('Tesseract version info:', versionInfo);
            resolve(versionInfo);
          } else {
            reject(new Error('Tesseract version check failed'));
          }
        });
      });
    } catch (error) {
      console.error('Tesseract verification failed:', error);
      return NextResponse.json(
        { error: 'Tesseract OCR is not properly installed on the server' },
        { status: 500 }
      );
    }

    // Create temp directory using fs.promises.mkdir
    await mkdir(tempDir, { recursive: true });

    // Save uploaded files
    await writeFile(imagePath, Buffer.from(await image.arrayBuffer()));
    await writeFile(csvPath, Buffer.from(await csvFile.arrayBuffer()));

    // Verify files were written
    console.log('Image file exists:', fs.existsSync(imagePath));
    console.log('CSV file exists:', fs.existsSync(csvPath));
    console.log('Image file size:', fs.statSync(imagePath).size);
    console.log('CSV file size:', fs.statSync(csvPath).size);

    // Process timetable first
    const mainPyPath = resolve(join(projectRoot, 'main.py'));
    console.log('main.py path:', mainPyPath);
    console.log('main.py exists:', fs.existsSync(mainPyPath));

    const pythonProcess = spawn(pythonCommand, [
      mainPyPath,
      imagePath,
      csvPath,
      '--return-schedules'
    ], {
      cwd: projectRoot, // Set working directory to project root
    });

    const scheduleData = await new Promise((resolve, reject) => {
      let outputData = '';
      let errorData = '';

      pythonProcess.stdout.on('data', (data) => {
        const chunk = data.toString();
        console.log('Python stdout:', chunk);
        outputData += chunk;
      });

      pythonProcess.stderr.on('data', (data) => {
        const chunk = data.toString();
        console.error('Python stderr:', chunk);
        errorData += chunk;
      });

      pythonProcess.on('close', (code) => {
        console.log('Python process exited with code:', code);
        
        if (code !== 0) {
          reject(new Error(`Python process failed with code ${code}: ${errorData}`));
          return;
        }

        try {
          const jsonMatch = outputData.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            console.error('No JSON data found in output:', outputData);
            reject(new Error('No JSON data found in output'));
            return;
          }
          resolve(JSON.parse(jsonMatch[0]));
        } catch (error) {
          console.error('Failed to parse output:', error);
          reject(new Error(`Failed to parse output: ${outputData}`));
        }
      });

      pythonProcess.on('error', (error) => {
        console.error('Failed to start Python process:', error);
        reject(new Error(`Failed to start Python process: ${error.message}`));
      });
    });

    if (!syncToCalendar) {
      return NextResponse.json({ schedule: scheduleData });
    }

    // Save schedule data to file for calendar sync
    await writeFile(schedulePath, JSON.stringify(scheduleData));

    // Calendar sync path
    const calendarSyncPath = resolve(join(projectRoot, 'calendar_sync.py'));
    console.log('calendar_sync.py path:', calendarSyncPath);
    console.log('calendar_sync.py exists:', fs.existsSync(calendarSyncPath));

    const calendarProcess = spawn(pythonCommand, [
      calendarSyncPath,
      schedulePath,
      selectedDays || '',
      String(isRecurring),
      projectRoot,
      startDate || ''
    ], {
      cwd: projectRoot, // Set working directory to project root
    });

    const result = await new Promise((resolve, reject) => {
      let outputData = '';
      let errorData = '';

      calendarProcess.stdout.on('data', (data) => {
        const chunk = data.toString();
        console.log('Calendar sync stdout:', chunk);
        outputData += chunk;
      });

      calendarProcess.stderr.on('data', (data) => {
        const chunk = data.toString();
        console.error('Calendar sync stderr:', chunk);
        errorData += chunk;
      });

      calendarProcess.on('close', (code) => {
        console.log('Calendar sync process exited with code:', code);
        
        if (code !== 0) {
          reject(new Error(`Calendar sync failed with code ${code}: ${errorData}`));
          return;
        }

        try {
          const jsonMatch = outputData.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            reject(new Error('No JSON response from calendar sync'));
            return;
          }
          const result = JSON.parse(jsonMatch[0]);
          
          // If auth is needed, prepare the auth window
          if (!result.success && result.needs_auth) {
            // Start the new window auth process
            const authProcess = spawn(pythonCommand, [
              calendarSyncPath,
              '--auth-new-window',
              projectRoot
            ], {
              cwd: projectRoot,
            });

            // Wait for auth script preparation
            let authOutput = '';
            authProcess.stdout.on('data', (data) => {
              authOutput += data.toString();
            });

            authProcess.on('close', async (authCode) => {
              if (authCode === 0) {
                try {
                  const jsonMatch = authOutput.match(/\{[\s\S]*\}/);
                  if (!jsonMatch) {
                    console.error('No JSON in auth output:', authOutput);
                    resolve(result);
                    return;
                  }
                  const authResult = JSON.parse(jsonMatch[0]);
                  if (authResult.success && authResult.auth_script) {
                    // Launch the auth window using appropriate command based on OS
                    if (process.platform === 'win32') {
                      spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', `python "${authResult.auth_script}"`], {
                        cwd: projectRoot,
                        shell: true,
                      });
                    } else {
                      // For Linux/Unix systems
                      spawn('xterm', ['-e', `${pythonCommand} "${authResult.auth_script}"`], {
                        cwd: projectRoot,
                      });
                    }

                    // Clean up auth script after a delay
                    setTimeout(() => {
                      try {
                        if (fs.existsSync(authResult.auth_script)) {
                          fs.unlinkSync(authResult.auth_script);
                        }
                      } catch (error) {
                        console.error('Failed to clean up auth script:', error);
                      }
                    }, 60000);

                    result.auth_window_opened = true;
                  }
                } catch (error) {
                  console.error('Auth window launch error:', error);
                }
              }
              resolve(result);
            });
          } else {
            resolve(result);
          }
        } catch (error) {
          reject(new Error(`Failed to parse calendar sync response: ${error}`));
        }
      });

      calendarProcess.on('error', (error) => {
        console.error('Failed to start calendar sync:', error);
        reject(new Error(`Failed to start calendar sync: ${error.message}`));
      });
    });

    // Clean up uploaded files
    try {
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
      if (fs.existsSync(csvPath)) {
        fs.unlinkSync(csvPath);
      }
    } catch (error) {
      console.error('Failed to clean up uploaded files:', error);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Processing error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process request' },
      { status: 500 }
    );
  } finally {
    // Cleanup
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch (error) {
        console.error('Failed to cleanup:', error);
      }
    }
  }
} 