import { NextResponse } from 'next/server';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { existsSync } from 'fs';

export async function POST() {
    try {
        const projectRoot = join(process.cwd(), '..');
        const tokenPath = join(projectRoot, 'token.json');

        if (existsSync(tokenPath)) {
            await unlink(tokenPath);
            return NextResponse.json({ success: true, message: 'Token file deleted' });
        }

        return NextResponse.json({ success: true, message: 'Token file not found' });
    } catch (error) {
        console.error('Error deleting token file:', error);
        return NextResponse.json(
            { error: 'Failed to delete token file' },
            { status: 500 }
        );
    }
} 