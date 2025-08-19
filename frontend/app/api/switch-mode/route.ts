import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { mode, roomName } = await request.json();
    
    if (!roomName) {
      return NextResponse.json(
        { success: false, error: 'Room name is required' },
        { status: 400 }
      );
    }
    
    // Instead of writing to file, we'll return the mode for the frontend to send via room data
    // The frontend will handle sending this to the agent via LiveKit room communication
    console.log(`Mode switch requested: ${mode} for room: ${roomName}`);
    
    return NextResponse.json({ 
      success: true, 
      message: `Mode switch to ${mode} ready for room communication`,
      mode,
      roomName
    });
  } catch (error) {
    console.error('Error processing mode switch:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process mode switch' },
      { status: 500 }
    );
  }
}
