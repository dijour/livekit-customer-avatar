import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function GET() {
  try {
    console.log("=== Testing OpenAI API Key ===");
    console.log("API Key present:", !!process.env.OPENAI_API_KEY);
    console.log("API Key length:", process.env.OPENAI_API_KEY?.length || 0);
    
    // Test with a simple image generation call
    const response = await openai.images.generate({
      model: "gpt-image-1",
      prompt: "A simple red circle on white background",
      size: "256x256",
      response_format: "b64_json",
      n: 1
    });
    
    console.log("OpenAI API test successful");
    
    return NextResponse.json({
      success: true,
      message: "OpenAI API key is working",
      hasImage: !!(response.data && response.data[0]?.b64_json)
    });
    
  } catch (error) {
    console.error("=== OpenAI API Test Error ===");
    console.error("Error type:", error?.constructor?.name);
    console.error("Error message:", error instanceof Error ? error.message : String(error));
    console.error("Full error:", error);
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      type: error?.constructor?.name || "Unknown"
    }, { status: 500 });
  }
}
