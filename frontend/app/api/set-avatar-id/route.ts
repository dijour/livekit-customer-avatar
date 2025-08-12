import { NextRequest, NextResponse } from "next/server";
import { writeFileSync } from "fs";
import { join } from "path";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { assetId } = body;

    if (!assetId) {
      return NextResponse.json(
        { error: "Asset ID is required" },
        { status: 400 }
      );
    }

    // Write asset ID to a file that the backend can read
    const backendDir = join(process.cwd(), "..", "backend");
    const assetIdFile = join(backendDir, "current_asset_id.txt");
    
    writeFileSync(assetIdFile, assetId);
    
    console.log(`Set asset ID: ${assetId}`);

    return NextResponse.json({ success: true, assetId });
  } catch (error) {
    console.error("Error setting asset ID:", error);
    return NextResponse.json(
      { error: "Failed to set asset ID" },
      { status: 500 }
    );
  }
}
