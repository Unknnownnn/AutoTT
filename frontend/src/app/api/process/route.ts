import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { join } from 'path';
import { writeFile } from 'fs/promises';
import { existsSync, mkdirSync, unlinkSync } from 'fs';

export async function POST(request: Request): Promise<Response> {
    try {
        const formData = await request.formData();
        const image = formData.get('image') as File;
        const csvFile = formData.get('csv_file') as File;
        const syncToCalendar = formData.get('sync_to_calendar') === 'true';
        const selectedDays = formData.get('selected_days')?.toString() || '';
        const isRecurring = formData.get('is_recurring') === 'true';
        const startDate = formData.get('start_date')?.toString() || '';

        if (!image || !csvFile) {
            return NextResponse.json(
                { error: 'Both image and CSV file are required' },
                { status: 400 }
            );
        }

        // Create uploads directory if it doesn't exist
        const projectRoot = join(process.cwd(), '..');
        const uploadsDir = join(projectRoot, 'uploads');
        if (!existsSync(uploadsDir)) {
            mkdirSync(uploadsDir);
        }

        // Save files
        const imageBuffer = Buffer.from(await image.arrayBuffer());
        const csvBuffer = Buffer.from(await csvFile.arrayBuffer());
        const imagePath = join(uploadsDir, 'temp_image' + image.name.substring(image.name.lastIndexOf('.')));
        const csvPath = join(uploadsDir, 'temp_csv.csv');

        await writeFile(imagePath, imageBuffer);
        await writeFile(csvPath, csvBuffer);

        return new Promise<Response>((resolve) => {
            const args = [
                join(projectRoot, 'calendar_sync.py'),
                '--image', imagePath,
                '--csv', csvPath,
            ];

            if (syncToCalendar) {
                args.push('--sync-calendar');
                if (selectedDays) args.push('--days', selectedDays);
                if (isRecurring) args.push('--recurring');
                if (startDate) args.push('--start-date', startDate);
            }

            const pythonProcess = spawn('python', args);

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
                // Cleanup uploaded files
                try {
                    unlinkSync(imagePath);
                    unlinkSync(csvPath);
                } catch (cleanupError) {
                    console.error('Error cleaning up files:', cleanupError);
                }

                if (code !== 0) {
                    console.error('Process failed:', errorData);
                    resolve(NextResponse.json(
                        { error: `Process failed: ${errorData}` },
                        { status: 500 }
                    ));
                    return;
                }

                try {
                    const jsonStr = outputData.trim().split('\n').pop() || '';
                    const result = JSON.parse(jsonStr);
                    resolve(NextResponse.json(result));
                } catch (parseError) {
                    console.error('Failed to parse Python output:', parseError);
                    resolve(NextResponse.json(
                        { error: `Failed to parse Python output: ${outputData}` },
                        { status: 500 }
                    ));
                }
            });
        });
    } catch (error) {
        console.error('Error in process:', error);
        return NextResponse.json(
            { error: 'Failed to process request' },
            { status: 500 }
        );
    }
} 