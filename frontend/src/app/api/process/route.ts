import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import os from 'os';
import fs from 'fs';

// Helper function to find Python executable
function getPythonCommand() {
  if (process.platform === 'win32') {
    // Try 'python' first, then 'py' on Windows
    try {
      spawn('python', ['--version']);
      return 'python';
    } catch {
      return 'py';
    }
  }
  return 'python3';  // Use python3 on Unix-like systems
}

// Helper function to sanitize process output
function sanitizeOutput(output: string): string {
  return output.replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F-\u009F]/g, '');
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
    
    // Get the project root directory for credentials
    const projectRoot = process.cwd().includes('frontend') 
      ? join(process.cwd(), '..') 
      : process.cwd();
      
    console.log('Project root:', projectRoot);
    console.log('Python command:', pythonCommand);
    console.log('Image path:', imagePath);
    console.log('CSV path:', csvPath);

    try {
      // Create temp directory using fs.promises.mkdir
      await mkdir(tempDir, { recursive: true });

      // Save uploaded files
      await writeFile(imagePath, Buffer.from(await image.arrayBuffer()));
      await writeFile(csvPath, Buffer.from(await csvFile.arrayBuffer()));
      
      console.log('Files saved successfully');
    } catch (err) {
      console.error('Error saving files:', err);
      throw new Error('Failed to save uploaded files');
    }

    // Process timetable first
    const pythonProcess = spawn(pythonCommand, [
      join(projectRoot, 'main.py'),
      imagePath,
      csvPath,
      '--return-schedules'
    ], {
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1'
      }
    });

    const scheduleData = await new Promise((resolve, reject) => {
      let outputData = '';
      let errorData = '';

      pythonProcess.stdout.on('data', (data) => {
        const sanitizedData = sanitizeOutput(data.toString());
        console.log('Python stdout:', sanitizedData);
        outputData += sanitizedData;
      });

      pythonProcess.stderr.on('data', (data) => {
        const sanitizedData = sanitizeOutput(data.toString());
        console.error('Python stderr:', sanitizedData);
        errorData += sanitizedData;
      });

      pythonProcess.on('close', (code) => {
        console.log('Python process exited with code:', code);
        if (code !== 0) {
          reject(new Error(`Python process failed (code ${code}): ${errorData}`));
          return;
        }

        try {
          // Look for JSON data in the output
          const jsonMatch = outputData.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            console.error('Full output:', outputData);
            reject(new Error('No JSON data found in output'));
            return;
          }

          // Parse and validate the JSON data
          const jsonData = JSON.parse(jsonMatch[0]);
          if (!jsonData || typeof jsonData !== 'object') {
            throw new Error('Invalid JSON data structure');
          }

          resolve(jsonData);
        } catch (err) {
          console.error('Parse error:', err);
          console.error('Full output:', outputData);
          reject(new Error(`Failed to parse output: ${err instanceof Error ? err.message : 'Unknown error'}`));
        }
      });

      pythonProcess.on('error', (err) => {
        console.error('Process error:', err);
        reject(new Error(`Failed to start process: ${err.message}`));
      });
    });

    if (!syncToCalendar) {
      return NextResponse.json({ schedule: scheduleData });
    }

    // Save schedule data to file for calendar sync
    await writeFile(schedulePath, JSON.stringify(scheduleData));

    // Calendar sync path
    const calendarProcess = spawn(pythonCommand, [
      join(projectRoot, 'calendar_sync.py'),
      schedulePath,
      selectedDays || '',
      String(isRecurring),
      projectRoot,
      startDate || ''
    ]);

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
        if (code !== 0) {
          reject(new Error(`Calendar sync failed: ${errorData}`));
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
              join(projectRoot, 'calendar_sync.py'),
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
                    // Launch the auth window using cmd.exe
                    spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', `${pythonCommand} "${authResult.auth_script}"`], {
                      cwd: projectRoot,
                      shell: true,
                    });

                    // Clean up auth script after a delay
                    setTimeout(() => {
                      try {
                        if (fs.existsSync(authResult.auth_script)) {
                          fs.unlinkSync(authResult.auth_script);
                        }
                      } catch (err) {
                        console.error('Failed to clean up auth script:', err);
                      }
                    }, 60000);

                    result.auth_window_opened = true;
                  }
                } catch (err) {
                  console.error('Auth window launch error:', err);
                }
              }
              resolve(result);
            });
          } else {
            resolve(result);
          }
        } catch (err) {
          reject(new Error(`Failed to parse calendar sync response: ${err}`));
        }
      });

      calendarProcess.on('error', (err) => {
        reject(new Error(`Failed to start calendar sync: ${err.message}`));
      });
    });

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
      } catch (err) {
        console.error('Failed to cleanup:', err);
      }
    }
  }
} 