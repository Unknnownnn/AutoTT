import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { existsSync } from 'fs';

export async function GET(): Promise<Response> {
    try {
        const projectRoot = join(process.cwd(), '..');
        const tokenPath = join(projectRoot, 'token.json');

        if (!existsSync(tokenPath)) {
            return NextResponse.json({
                success: true,
                authenticated: false,
                message: 'Not authenticated'
            });
        }

        return new Promise<Response>((resolve) => {
            const pythonProcess = spawn('python', [
                join(projectRoot, 'calendar_sync.py'),
                '--get-user',
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
                if (code !== 0) {
                    console.error('Process failed:', errorData);
                    resolve(NextResponse.json(
                        { success: false, authenticated: false, message: 'Failed to get user info' },
                        { status: 500 }
                    ));
                    return;
                }

                try {
                    const jsonStr = outputData.trim().split('\n').pop() || '';
                    const result = JSON.parse(jsonStr);
                    resolve(NextResponse.json(result));
                } catch (error) {
                    console.error('Failed to parse Python output:', error);
                    resolve(NextResponse.json(
                        { success: false, authenticated: false, message: 'Failed to parse user info' },
                        { status: 500 }
                    ));
                }
            });
        });
    } catch (error) {
        console.error('Error in get user:', error);
        return NextResponse.json(
            { success: false, authenticated: false, message: 'Internal server error' },
            { status: 500 }
        );
    }
}

export async function POST(request: Request): Promise<Response> {
    try {
        const data = await request.json();
        
        if (data.action === 'logout') {
            const projectRoot = join(process.cwd(), '..');
            const tokenPath = join(projectRoot, 'token.json');

            try {
                if (existsSync(tokenPath)) {
                    await unlink(tokenPath);
                }
                return NextResponse.json({
                    success: true,
                    message: 'Logged out successfully'
                });
            } catch (error) {
                console.error('Error during logout:', error);
                return NextResponse.json(
                    { success: false, message: 'Failed to logout' },
                    { status: 500 }
                );
            }
        }

        return NextResponse.json(
            { success: false, message: 'Invalid action' },
            { status: 400 }
        );
    } catch (error) {
        console.error('Error in post user:', error);
        return NextResponse.json(
            { success: false, message: 'Internal server error' },
            { status: 500 }
        );
    }
} 