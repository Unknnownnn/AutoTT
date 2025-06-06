import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { join } from 'path';

export async function POST(request: Request): Promise<Response> {
    try {
        const data = await request.json();
        // Get the project root directory (go up three levels from api/calendar-auth)
        const projectRoot = join(process.cwd(), '..');
        
        // If we have an auth code, complete the authentication
        if (data.code) {
            return new Promise<Response>((resolve) => {
                const pythonProcess = spawn('python', [
                    join(projectRoot, 'calendar_sync.py'),
                    '--complete-auth',
                    data.code,
                    projectRoot
                ]);

                let outputData = '';
                let errorData = '';

                pythonProcess.stdout.on('data', (data) => {
                    outputData += data.toString();
                });

                pythonProcess.stderr.on('data', (data) => {
                    errorData += data.toString();
                    console.error('Python stderr:', errorData);
                });

                pythonProcess.on('close', (code) => {
                    console.log('Python process exited with code:', code);
                    console.log('Python output:', outputData);
                    
                    if (code !== 0) {
                        resolve(NextResponse.json(
                            { error: `Process failed: ${errorData}` },
                            { status: 500 }
                        ));
                        return;
                    }

                    try {
                        // Find the last valid JSON object in the output
                        const jsonStr = outputData.trim().split('\n').pop() || '';
                        const result = JSON.parse(jsonStr);
                        resolve(NextResponse.json(result));
                    } catch (e) {
                        console.error('Failed to parse Python output:', e);
                        resolve(NextResponse.json(
                            { error: `Failed to parse Python output: ${outputData}` },
                            { status: 500 }
                        ));
                    }
                });
            });
        }
        
        // Start the authentication process
        return new Promise<Response>((resolve) => {
            const pythonProcess = spawn('python', [
                join(projectRoot, 'calendar_sync.py'),
                '--auth',
                projectRoot
            ]);

            let outputData = '';
            let errorData = '';

            pythonProcess.stdout.on('data', (data) => {
                outputData += data.toString();
            });

            pythonProcess.stderr.on('data', (data) => {
                errorData += data.toString();
                console.error('Python stderr:', errorData);
            });

            pythonProcess.on('close', (code) => {
                console.log('Python process exited with code:', code);
                console.log('Python output:', outputData);
                
                if (code !== 0) {
                    resolve(NextResponse.json(
                        { error: `Process failed: ${errorData}` },
                        { status: 500 }
                    ));
                    return;
                }

                try {
                    // Find the last valid JSON object in the output
                    const jsonStr = outputData.trim().split('\n').pop() || '';
                    const result = JSON.parse(jsonStr);
                    resolve(NextResponse.json(result));
                } catch (e) {
                    console.error('Failed to parse Python output:', e);
                    resolve(NextResponse.json(
                        { error: `Failed to parse Python output: ${outputData}` },
                        { status: 500 }
                    ));
                }
            });
        });
    } catch (error) {
        console.error('Error in calendar auth:', error);
        return NextResponse.json(
            { error: 'Failed to process authentication' },
            { status: 500 }
        );
    }
} 