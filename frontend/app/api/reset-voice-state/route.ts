import { NextRequest, NextResponse } from "next/server";
import { existsSync, unlinkSync } from "fs";
import { join } from "path";

export async function POST(request: NextRequest) {
  try {
    const backendDir = join(process.cwd(), "..", "backend");
    const voiceStateFile = join(backendDir, "voice_state.txt");
    const assetIdFile = join(backendDir, "current_asset_id.txt");
    
    // Remove voice state file to reset to Alexa mode
    if (existsSync(voiceStateFile)) {
      unlinkSync(voiceStateFile);
      console.log("Reset voice state to Alexa mode");
    }
    
    // Optionally clear asset ID if requested
    const body = await request.json();
    if (body.clearAssetId && existsSync(assetIdFile)) {
      unlinkSync(assetIdFile);
      console.log("Cleared asset ID");
    }

    return NextResponse.json({ success: true, message: "Voice state reset to Alexa mode" });
  } catch (error) {
    console.error("Error resetting voice state:", error);
    return NextResponse.json(
      { error: "Failed to reset voice state" },
      { status: 500 }
    );
  }
}
