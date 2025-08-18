import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    // Return the current avatar state from global storage
    const avatarState = (global as any).avatarState;
    
    if (avatarState) {
      return NextResponse.json(avatarState);
    } else {
      return NextResponse.json(null);
    }
  } catch (error) {
    console.error("Error getting avatar state:", error);
    return NextResponse.json(
      { error: "Failed to get avatar state" },
      { status: 500 }
    );
  }
}
