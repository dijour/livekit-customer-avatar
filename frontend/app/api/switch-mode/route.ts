import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "fs/promises";
import { join } from "path";

export async function POST(request: NextRequest) {
  try {
    const { mode } = await request.json();
    
    // Write mode to backend state file
    const backendDir = join(process.cwd(), '..', 'backend');
    const modeFilePath = join(backendDir, 'alexa_mode.txt');
    
    await writeFile(modeFilePath, mode === 'avatar' ? 'false' : 'true', 'utf8');
    
    console.log(`Mode switched to: ${mode}`);
    
    return NextResponse.json({ 
      success: true, 
      message: `Mode switched to ${mode}` 
    });
  } catch (error) {
    console.error('Error switching mode:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to switch mode' },
      { status: 500 }
    );
  }
}
