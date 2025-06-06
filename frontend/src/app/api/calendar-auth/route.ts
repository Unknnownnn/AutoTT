import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { join } from 'path';
import { existsSync, writeFileSync } from 'fs';

export async function POST(request: Request): Promise<Response> {
    try {
        const data = await request.json();
        
        // Get the project root directory
        const projectRoot = process.cwd().includes('frontend') 
            ? join(process.cwd(), '..') 
            : process.cwd();

        console.log('Project root:', projectRoot);
        console.log('Current working directory:', process.cwd());
        
        // Create credentials.json dynamically
        const credentials = {
            "web": {
                "client_id": process.env.GOOGLE_CLIENT_ID,
                "project_id": process.env.GOOGLE_PROJECT_ID,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
                "client_secret": process.env.GOOGLE_CLIENT_SECRET,
                "redirect_uris": [process.env.GOOGLE_REDIRECT_URI]
            }
        };

        const credentialsPath = join(projectRoot, 'credentials.json');
        console.log('Writing credentials to:', credentialsPath);
        writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2));
        
        // Check if Python script exists
        const scriptPath = join(projectRoot, 'calendar_sync.py');
        if (!existsSync(scriptPath)) {
            console.error('Python script not found at:', scriptPath);
            return NextResponse.json(
                { error: 'Calendar sync script not found' },
                { status: 500 }
            );
        }
        
        // If we have an auth code, complete the authentication
        if (data.code) {
            console.log('Completing authentication with code');
            return new Promise<Response>((resolve) => {
                const pythonProcess = spawn('python', [
                    scriptPath,
                    '--complete-auth',
                    data.code,
                    projectRoot
                ]);

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

                pythonProcess.on('error', (error) => {
                    console.error('Failed to start Python process:', error);
                    resolve(NextResponse.json(
                        { error: `Failed to start process: ${error.message}` },
                        { status: 500 }
                    ));
                });

                pythonProcess.on('close', (code) => {
                    console.log('Python process exited with code:', code);
                    console.log('Final output:', outputData);
                    
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
                        console.log('Parsing JSON:', jsonStr);
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
        console.log('Starting authentication process');
        return new Promise<Response>((resolve) => {
            const pythonProcess = spawn('python', [
                scriptPath,
                '--auth',
                projectRoot
            ]);

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

            pythonProcess.on('error', (error) => {
                console.error('Failed to start Python process:', error);
                resolve(NextResponse.json(
                    { error: `Failed to start process: ${error.message}` },
                    { status: 500 }
                ));
            });

            pythonProcess.on('close', (code) => {
                console.log('Python process exited with code:', code);
                console.log('Final output:', outputData);
                
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
                    console.log('Parsing JSON:', jsonStr);
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