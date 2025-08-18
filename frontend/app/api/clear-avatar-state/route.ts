import { NextResponse } from "next/server";

export async function POST() {
  try {
    console.log("Clearing avatar state from global storage");
    
    // Clear the in-memory avatar state
    (global as { avatarState?: any }).avatarState = null;

    return NextResponse.json({ success: true, message: "Avatar state cleared" });
  } catch (error) {
    console.error("Error clearing avatar state:", error);
    return NextResponse.json(
      { error: "Failed to clear avatar state" },
      { status: 500 }
    );
  }
}
