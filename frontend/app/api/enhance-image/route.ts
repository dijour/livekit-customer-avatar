import { NextRequest, NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import path from 'path';
import fs from 'fs';
import { Blob } from 'buffer';

// Polyfill File for Node.js environments before Node 20
if (typeof globalThis.File === 'undefined') {
  const { File: NodeFile } = require('node:buffer');
  globalThis.File = NodeFile;
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    console.log("=== Starting image enhancement ===");
    console.log("OpenAI API Key present:", !!process.env.OPENAI_API_KEY);
    console.log("OpenAI API Key length:", process.env.OPENAI_API_KEY?.length || 0);
    
    const formData = await request.formData();
    const uploadedFile = formData.get("image") as File;
    const customPrompt = formData.get("prompt") as string;

    if (!uploadedFile) {
      console.log("Error: No image file provided");
      return NextResponse.json(
        { error: "No image file provided" },
        { status: 400 }
      );
    }

    console.log("File details:", {
      name: uploadedFile.name,
      size: uploadedFile.size,
      type: uploadedFile.type
    });

    console.log("Custom prompt provided:", !!customPrompt);
    if (customPrompt) {
      console.log("Custom prompt:", customPrompt);
    }

    // Convert the image file to buffer
    const bytes = await uploadedFile.arrayBuffer();
    const buffer = Buffer.from(bytes);

    console.log("Image converted to buffer, size:", buffer.length);
    console.log("Enhancing image with OpenAI gpt-image-1...");

    // Convert the image buffer to a File object for OpenAI
    console.log("Converting buffer to File object...");
    const imageFile = await toFile(buffer, "photo.jpg", {
      type: "image/jpeg",
    });
    console.log("File object created successfully");

    // Debug: Save the image being sent to OpenAI
    const debugDir = path.join(process.cwd(), "debug");
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }
    const debugImagePath = path.join(debugDir, `input-${Date.now()}.jpg`);
    fs.writeFileSync(debugImagePath, buffer);
    console.log("Debug: Saved input image to:", debugImagePath);
    
    // Log image properties
    console.log("=== Image Debug Info ===");
    console.log("Buffer size:", buffer.length, "bytes");
    console.log("Buffer first 20 bytes:", buffer.subarray(0, 20));
    console.log("Is JPEG header:", buffer.subarray(0, 3).toString('hex') === 'ffd8ff');
    console.log("File object size:", imageFile.size);
    console.log("File object name:", imageFile.name);
    console.log("File object type:", imageFile.type);
    console.log("======================");

    // Use gpt-image-1 to enhance the image
    const enhancementPrompt = customPrompt || "Add a funny hat to this person.";

    console.log("Making OpenAI API call...");
    const imageResponse = await openai.images.edit({
      model: "gpt-image-1",
      image: imageFile,
      prompt: enhancementPrompt,
      size: "1024x1024",
      quality: "low"
    });
    console.log("OpenAI API call completed");
    console.log("Response data length:", imageResponse.data?.length || 0);
    // console.log("Response structure:", JSON.stringify(imageResponse.data?.[0] || {}, null, 2));

    if (!imageResponse.data || imageResponse.data.length === 0) {
      console.log("Error: No image data received from OpenAI");
      return NextResponse.json(
        { error: "No image data received from OpenAI" },
        { status: 500 }
      );
    }

    // Check if we got base64 data directly or a URL
    const responseData = imageResponse.data[0];
    const imageUrl = responseData?.url;
    const base64Data = responseData?.b64_json || (responseData as any)?.data;
    
    console.log("Image URL received:", imageUrl);
    console.log("Base64 data present:", !!base64Data);
    console.log("Base64 data length:", base64Data?.length || 0);

    let enhancedImageBase64: string;

    if (base64Data) {
      // We got base64 data directly
      console.log("Using base64 data directly from response");
      enhancedImageBase64 = base64Data;
    } else if (imageUrl) {
      // We got a URL, need to fetch it
      console.log("Fetching enhanced image from URL:", imageUrl);
      const imageResponse2 = await fetch(imageUrl);
      console.log("Fetch response status:", imageResponse2.status, imageResponse2.statusText);
      
      if (!imageResponse2.ok) {
        console.log("Error: Failed to fetch enhanced image", imageResponse2.status, imageResponse2.statusText);
        return NextResponse.json(
          { error: `Failed to fetch enhanced image: ${imageResponse2.status} ${imageResponse2.statusText}` },
          { status: 500 }
        );
      }

      console.log("Converting image to buffer...");
      const imageBuffer = await imageResponse2.arrayBuffer();
      console.log("Image buffer size:", imageBuffer.byteLength);
      
      enhancedImageBase64 = Buffer.from(imageBuffer).toString('base64');
    } else {
      console.log("Error: No enhanced image URL or base64 data received");
      return NextResponse.json(
        { error: "No enhanced image data received" },
        { status: 500 }
      );
    }
    
    console.log("Final base64 length:", enhancedImageBase64.length);

    console.log("Image enhanced successfully");

    return NextResponse.json({
      success: true,
      enhancedImage: enhancedImageBase64,
      message: "Image enhanced successfully"
    });

  } catch (error) {
    console.error("=== Error enhancing image ===");
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
                             errorMessage.includes("safety system");
    
    return NextResponse.json(
      { 
        error: "Failed to enhance image", 
        details: errorMessage,
        type: error?.constructor?.name || "Unknown",
        isSafetyRejection
      },
      { status: isSafetyRejection ? 400 : 500 }
    );
  }
}