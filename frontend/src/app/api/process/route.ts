import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import os from 'os';
import fs from 'fs';

export async function POST(req: Request) {
  let tempDir = '';
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

    // Create temp directory using fs.promises.mkdir
    await mkdir(tempDir, { recursive: true });

    // Save uploaded files
    await writeFile(imagePath, Buffer.from(await image.arrayBuffer()));
    await writeFile(csvPath, Buffer.from(await csvFile.arrayBuffer()));

    // Process timetable first
    const pythonProcess = spawn('python', [
      join(projectRoot, 'main.py'),
      imagePath,
      csvPath,
      '--return-schedules'
    ]);

    const scheduleData = await new Promise((resolve, reject) => {
      let outputData = '';
      let errorData = '';

      pythonProcess.stdout.on('data', (data) => {
        outputData += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        errorData += data.toString();
      });

      pythonProcess.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Python process failed: ${errorData}`));
          return;
        }

        try {
          const jsonMatch = outputData.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            reject(new Error('No JSON data found in output'));
            return;
          }
          resolve(JSON.parse(jsonMatch[0]));
        } catch (_) {
          reject(new Error(`Failed to parse output: ${outputData}`));
        }
      });

      pythonProcess.on('error', (err) => {
        reject(new Error(`Failed to start process: ${err.message}`));
      });
    });

    if (!syncToCalendar) {
      return NextResponse.json({ schedule: scheduleData });
    }

    // Save schedule data to file for calendar sync
    await writeFile(schedulePath, JSON.stringify(scheduleData));

    // Calendar sync path
    const calendarProcess = spawn('python', [
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
            const authProcess = spawn('python', [
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
                    spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', `python "${authResult.auth_script}"`], {
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

    // Clean up uploaded files
    try {
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
      if (fs.existsSync(csvPath)) {
        fs.unlinkSync(csvPath);
      }
    } catch (err) {
      console.error('Failed to clean up uploaded files:', err);
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
      } catch (err) {
        console.error('Failed to cleanup:', err);
      }
    }
  }
} 