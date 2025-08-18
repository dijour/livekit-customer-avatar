import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { assetId, switchVoice } = body;

    if (!assetId) {
      return NextResponse.json(
        { error: "Asset ID is required" },
        { status: 400 }
      );
    }

    console.log(`Avatar ID received: ${assetId}`);
    if (switchVoice) {
      console.log("Voice switch requested");
    }
    
    // Store in a simple in-memory store that backend can check
    // This is a temporary solution - in production you'd use Redis or similar
    (global as any).avatarState = {
      assetId,
      switchVoice: switchVoice || false,
      timestamp: Date.now()
    };

    return NextResponse.json({ success: true, assetId });
  } catch (error) {
    console.error("Error setting asset ID:", error);
    return NextResponse.json(
      { error: "Failed to set asset ID" },
      { status: 500 }
    );
  }
}
