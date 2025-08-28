import { NextRequest, NextResponse } from "next/server";
import fs from 'fs';
import path from 'path';

export async function POST(request: NextRequest) {
  try {
    console.log("🔄 Avatar restart requested");
    
    // Create a restart signal file that the backend can monitor
    const restartSignalPath = path.join(process.cwd(), '../../backend/restart_avatar.txt');
    fs.writeFileSync(restartSignalPath, new Date().toISOString());
    
    console.log("✅ Restart signal sent to backend");
    
    return NextResponse.json({
      success: true,
      message: "Avatar restart signal sent"
    });

  } catch (error) {
    console.error("❌ Failed to send restart signal:", error);
    return NextResponse.json(
      { 
        error: "Failed to send restart signal",
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
