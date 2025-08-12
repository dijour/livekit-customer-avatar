import { NextRequest, NextResponse } from "next/server";

const HEDRA_API_KEY = process.env.HEDRA_API_KEY;

if (!HEDRA_API_KEY) {
  throw new Error("HEDRA_API_KEY environment variable is required");
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("photo") as File;

    if (!file) {
      return NextResponse.json(
        { error: "No photo file provided" },
        { status: 400 }
      );
    }

    console.log("Creating Hedra asset...");

    // Step 1: Create a new asset
    const createAssetResponse = await fetch("https://api.hedra.com/web-app/public/assets", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": HEDRA_API_KEY!,
      },
      body: JSON.stringify({
        name: `avatar-photo-${Date.now()}`,
        type: "image",
      }),
    });

    if (!createAssetResponse.ok) {
      const errorText = await createAssetResponse.text();
      console.error("Failed to create Hedra asset:", errorText);
      return NextResponse.json(
        { error: "Failed to create Hedra asset" },
        { status: 500 }
      );
    }

    const assetData = await createAssetResponse.json();
    const assetId = assetData.id;

    console.log("Created Hedra asset with ID:", assetId);

    // Step 2: Upload the photo to the asset
    const uploadFormData = new FormData();
    uploadFormData.append("file", file);

    const uploadResponse = await fetch(
      `https://api.hedra.com/web-app/public/assets/${assetId}/upload`,
      {
        method: "POST",
        headers: {
          "X-API-Key": HEDRA_API_KEY!,
        },
        body: uploadFormData,
      }
    );

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error("Failed to upload photo to Hedra:", errorText);
      return NextResponse.json(
        { error: "Failed to upload photo to Hedra" },
        { status: 500 }
      );
    }

    console.log("Successfully uploaded photo to Hedra asset:", assetId);

    // Step 3: Return the asset ID - the Hedra backend will handle avatar creation
    // The asset ID will be used by the backend to create the avatar
    
    return NextResponse.json({
      success: true,
      assetId,
      message: "Photo uploaded to Hedra asset successfully",
    });

  } catch (error) {
    console.error("Error in create-avatar API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
