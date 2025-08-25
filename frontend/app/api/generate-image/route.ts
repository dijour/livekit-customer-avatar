import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    console.log("=== Starting image generation ===");
    console.log("OpenAI API Key present:", !!process.env.OPENAI_API_KEY);
    
    const formData = await request.formData();
    const customPrompt = formData.get("prompt") as string;

    if (!customPrompt) {
      console.log("Error: No prompt provided");
      return NextResponse.json(
        { error: "No prompt provided" },
        { status: 400 }
      );
    }

    console.log("Generating image with prompt:", customPrompt);

    // Use OpenAI DALL-E to generate an image
    const imageResponse = await openai.images.generate({
      model: "dall-e-3",
      prompt: customPrompt,
      size: "1024x1024",
      quality: "standard",
      n: 1,
    });

    console.log("OpenAI image generation completed");
    console.log("Response data length:", imageResponse.data?.length || 0);

    if (!imageResponse.data || imageResponse.data.length === 0) {
      console.log("Error: No image data received from OpenAI");
      return NextResponse.json(
        { error: "No image data received from OpenAI" },
        { status: 500 }
      );
    }

    // Get the generated image URL
    const responseData = imageResponse.data[0];
    const imageUrl = responseData?.url;
    
    console.log("Generated image URL received:", imageUrl);

    if (!imageUrl) {
      console.log("Error: No image URL received");
      return NextResponse.json(
        { error: "No image URL received from OpenAI" },
        { status: 500 }
      );
    }

    // Fetch the image and convert to base64
    console.log("Fetching generated image from URL:", imageUrl);
    const imageResponse2 = await fetch(imageUrl);
    console.log("Fetch response status:", imageResponse2.status, imageResponse2.statusText);
    
    if (!imageResponse2.ok) {
      console.log("Error: Failed to fetch generated image", imageResponse2.status, imageResponse2.statusText);
      return NextResponse.json(
        { error: `Failed to fetch generated image: ${imageResponse2.status} ${imageResponse2.statusText}` },
        { status: 500 }
      );
    }

    console.log("Converting image to buffer...");
    const imageBuffer = await imageResponse2.arrayBuffer();
    console.log("Image buffer size:", imageBuffer.byteLength);
    
    const generatedImageBase64 = Buffer.from(imageBuffer).toString('base64');
    console.log("Final base64 length:", generatedImageBase64.length);

    console.log("Image generated successfully");

    return NextResponse.json({
      success: true,
      generatedImage: generatedImageBase64,
      message: "Image generated successfully"
    });

  } catch (error) {
    console.error("=== Error generating image ===");
    console.error("Error type:", error?.constructor?.name);
    console.error("Error message:", error instanceof Error ? error.message : String(error));
    console.error("Full error:", error);
    
    // Check for specific OpenAI errors
    if (error && typeof error === 'object' && 'error' in error) {
      console.error("OpenAI API error details:", (error as any).error);
    }
    
    // Check if this is a safety system rejection
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isSafetyRejection = errorMessage.includes("rejected by the safety system") || 
                             errorMessage.includes("safety system") ||
                             errorMessage.includes("content policy");
    
    return NextResponse.json(
      { 
        error: "Failed to generate image", 
        details: errorMessage,
        type: error?.constructor?.name || "Unknown",
        isSafetyRejection
      },
      { status: isSafetyRejection ? 400 : 500 }
    );
  }
}
