import { NextRequest, NextResponse } from "next/server";

const HEDRA_API_KEY = process.env.HEDRA_API_KEY;

// Only check for API key at runtime, not during build
if (process.env.NODE_ENV !== 'production' && !HEDRA_API_KEY) {
  console.warn("HEDRA_API_KEY environment variable is not set");
}

export async function GET(request: NextRequest) {
  try {
    // Check for API key at runtime
    if (!HEDRA_API_KEY) {
      return NextResponse.json(
        { error: "HEDRA_API_KEY environment variable is required" },
        { status: 500 }
      );
    }

    // Get the asset ID from query parameters
    const { searchParams } = new URL(request.url);
    const assetId = searchParams.get('id');
    const assetType = searchParams.get('type') || 'image'; // Default to image type

    if (!assetId) {
      return NextResponse.json(
        { error: "Asset ID is required" },
        { status: 400 }
      );
    }

    console.log(`Fetching Hedra asset: ${assetId} (type: ${assetType})`);

    // Fetch the asset from Hedra API
    const hedraResponse = await fetch(
      `https://api.hedra.com/web-app/public/assets?type=${assetType}&ids=${assetId}`,
      {
        method: "GET",
        headers: {
          "X-API-Key": HEDRA_API_KEY,
        },
      }
    );

    if (!hedraResponse.ok) {
      const errorText = await hedraResponse.text();
      console.error("Failed to fetch Hedra asset:", errorText);
      return NextResponse.json(
        { error: "Failed to fetch asset from Hedra" },
        { status: hedraResponse.status }
      );
    }

    const assetData = await hedraResponse.json();
    
    console.log("Successfully fetched Hedra asset:", assetId);

    return NextResponse.json({
      success: true,
      data: assetData,
    });

  } catch (error) {
    console.error("Error in get-hedra-asset API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
