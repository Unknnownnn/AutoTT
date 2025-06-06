import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { join } from 'path';

export async function GET(_: Request) {
  try {
    // Get the project root directory
    const projectRoot = process.cwd().includes('frontend') 
      ? join(process.cwd(), '..') 
      : process.cwd();

    console.log('Fetching user info from:', projectRoot);

    const pythonProcess = spawn('python', [
      join(projectRoot, 'calendar_sync.py'),
      '--user-info',
      projectRoot
    ]);

    const result = await new Promise((resolve, reject) => {
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
          reject(new Error(`Process failed: ${errorData}`));
          return;
        }

        try {
          const jsonMatch = outputData.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            console.error('No JSON in output:', outputData);
            reject(new Error('No JSON response from process'));
            return;
          }
          const parsedResult = JSON.parse(jsonMatch[0]);
          console.log('Parsed user info result:', parsedResult);
          resolve(parsedResult);
        } catch {
          console.error('Failed to parse response:', outputData);
          reject(new Error(`Failed to parse response: ${outputData}`));
        }
      });
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error getting user info:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get user info' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const { action } = await req.json();
    
    if (action !== 'logout') {
      return NextResponse.json(
        { error: 'Invalid action' },
        { status: 400 }
      );
    }

    // Get the project root directory
    const projectRoot = process.cwd().includes('frontend') 
      ? join(process.cwd(), '..') 
      : process.cwd();

    const pythonProcess = spawn('python', [
      join(projectRoot, 'calendar_sync.py'),
      '--logout',
      projectRoot
    ]);

    const result = await new Promise((resolve, reject) => {
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
          reject(new Error(`Process failed: ${errorData}`));
          return;
        }

        try {
          const jsonMatch = outputData.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            reject(new Error('No JSON response from process'));
            return;
          }
          resolve(JSON.parse(jsonMatch[0]));
        } catch {
          reject(new Error(`Failed to parse response: ${outputData}`));
        }
      });
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error during logout:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to logout' },
      { status: 500 }
    );
  }
} 