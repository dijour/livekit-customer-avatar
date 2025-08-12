import { AccessToken, AccessTokenOptions, VideoGrant } from "livekit-server-sdk";
import { NextRequest, NextResponse } from "next/server";

// NOTE: you are expected to define the following environment variables in `.env.local`:
const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL;

// don't cache the results
export const revalidate = 0;

export type ConnectionDetails = {
  serverUrl: string;
  roomName: string;
  participantName: string;
  participantToken: string;
  assetId?: string;
};

async function createConnectionDetails(assetId?: string): Promise<ConnectionDetails> {
  if (LIVEKIT_URL === undefined) {
    throw new Error("LIVEKIT_URL is not defined");
  }
  if (API_KEY === undefined) {
    throw new Error("LIVEKIT_API_KEY is not defined");
  }
  if (API_SECRET === undefined) {
    throw new Error("LIVEKIT_API_SECRET is not defined");
  }

  // Generate participant token
  const participantIdentity = `voice_assistant_user_${crypto.randomUUID()}`;
  const roomName = `voice_assistant_room_${crypto.randomUUID()}`;
  const participantToken = await createParticipantToken(
    { identity: participantIdentity },
    roomName
  );

  // Return connection details
  return {
    serverUrl: LIVEKIT_URL,
    roomName,
    participantToken: participantToken,
    participantName: participantIdentity,
    assetId,
  };
}

export async function GET() {
  try {
    const data = await createConnectionDetails();
    const headers = new Headers({
      "Cache-Control": "no-store",
    });
    return NextResponse.json(data, { headers });
  } catch (error) {
    if (error instanceof Error) {
      console.error(error);
      return new NextResponse(error.message, { status: 500 });
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { assetId } = body;
    
    const data = await createConnectionDetails(assetId);
    const headers = new Headers({
      "Cache-Control": "no-store",
    });
    return NextResponse.json(data, { headers });
  } catch (error) {
    if (error instanceof Error) {
      console.error(error);
      return new NextResponse(error.message, { status: 500 });
    }
  }
}

function createParticipantToken(userInfo: AccessTokenOptions, roomName: string) {
  const at = new AccessToken(API_KEY, API_SECRET, {
    ...userInfo,
    ttl: "15m",
  });
  const grant: VideoGrant = {
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  };
  at.addGrant(grant);
  return at.toJwt();
}
