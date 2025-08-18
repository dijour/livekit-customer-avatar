import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    // Handle cases where request body might be empty
    let body = {};
    try {
      const text = await request.text();
      if (text) {
        body = JSON.parse(text);
      }
    } catch {
      // If parsing fails, continue with empty body
      console.log("No JSON body provided, using empty body");
    }

    const { clearAssetId } = body as { clearAssetId?: boolean };

    console.log("Voice reset requested");
    if (clearAssetId) {
      console.log("Asset ID clear requested");
    }
    
    // Clear the in-memory avatar state
    (global as any).avatarState = null;

    return NextResponse.json({ success: true, message: "Voice state reset to Alexa mode" });
  } catch (error) {
    console.error("Error resetting voice state:", error);
    return NextResponse.json(
      { error: "Failed to reset voice state" },
      { status: 500 }
    );
  }
}
