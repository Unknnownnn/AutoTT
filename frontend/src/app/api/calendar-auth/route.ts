import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { join } from 'path';
import fs from 'fs';

export async function POST(req: Request) {
  try {
    // Get the project root directory for credentials
    const projectRoot = process.cwd().includes('frontend') 
      ? join(process.cwd(), '..') 
      : process.cwd();

    // First, prepare the authentication script
    const prepareProcess = spawn('python', [
      join(projectRoot, 'calendar_sync.py'),
      '--auth-new-window',
      projectRoot
    ], {
      cwd: projectRoot,
    });

    const scriptPath = await new Promise((resolve, reject) => {
      let outputData = '';
      let errorData = '';

      prepareProcess.stdout.on('data', (data) => {
        outputData += data.toString();
      });

      prepareProcess.stderr.on('data', (data) => {
        console.error('Prepare auth stderr:', data.toString());
        errorData += data.toString();
      });

      prepareProcess.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Failed to prepare authentication: ${errorData}`));
          return;
        }

        try {
          const jsonMatch = outputData.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            reject(new Error('No JSON response from prepare script'));
            return;
          }
          const result = JSON.parse(jsonMatch[0]);
          if (!result.success) {
            reject(new Error(result.error || 'Failed to prepare authentication'));
            return;
          }
          resolve(result.auth_script);
        } catch (err) {
          reject(new Error(`Failed to parse prepare script response: ${err}`));
        }
      });
    });

    // Now launch the authentication script in a new window
    spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', `python "${scriptPath}"`], {
      cwd: projectRoot,
      shell: true,
    });

    // Wait a bit to ensure the script starts
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Clean up the temporary script after a delay
    setTimeout(() => {
      try {
        fs.unlinkSync(scriptPath);
      } catch (err) {
        console.error('Failed to clean up auth script:', err);
      }
    }, 60000); // Clean up after 1 minute

    return NextResponse.json({
      success: true,
      message: "Authentication window opened. Please complete the process in the new window."
    });

  } catch (error) {
    console.error('Authentication error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start authentication' },
      { status: 500 }
    );
  }
} 