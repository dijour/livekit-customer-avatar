import { NextRequest, NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const uploadedFile = formData.get("image") as File;

    if (!uploadedFile) {
      return NextResponse.json(
        { error: "No image file provided" },
        { status: 400 }
      );
    }

    // Convert the image file to base64
    const bytes = await uploadedFile.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64Image = buffer.toString("base64");

    console.log("Enhancing image with OpenAI gpt-image-1...");

    // Convert the image buffer to a File object for OpenAI
    const imageFile = await toFile(buffer, "photo.jpg", {
      type: "image/jpeg",
    });

    // Use gpt-image-1 to enhance the image
    const enhancementPrompt = "Enhance this photo to create a professional, high-quality avatar. Improve the lighting, clarity, and overall appearance while maintaining the person's natural features. Make the background clean and professional. Optimize for use as a digital avatar with clear, sharp details and good contrast.";

    const imageResponse = await openai.images.edit({
      model: "gpt-image-1",
      image: imageFile,
      prompt: enhancementPrompt,
      size: "1024x1024",
    });

    if (!imageResponse.data || imageResponse.data.length === 0) {
      return NextResponse.json(
        { error: "No image data received from OpenAI" },
        { status: 500 }
      );
    }

    // gpt-image-1 returns URL by default, we need to fetch and convert to base64
    const imageUrl = imageResponse.data[0]?.url;

    if (!imageUrl) {
      return NextResponse.json(
        { error: "No enhanced image URL received" },
        { status: 500 }
      );
    }

    // Fetch the image from the URL and convert to base64
    const imageResponse2 = await fetch(imageUrl);
    if (!imageResponse2.ok) {
      return NextResponse.json(
        { error: "Failed to fetch enhanced image" },
        { status: 500 }
      );
    }

    const imageBuffer = await imageResponse2.arrayBuffer();
    const enhancedImageBase64 = Buffer.from(imageBuffer).toString('base64');

    console.log("Image enhanced successfully");

    return NextResponse.json({
      success: true,
      enhancedImage: enhancedImageBase64,
      message: "Image enhanced successfully"
    });

  } catch (error) {
    console.error("Error enhancing image:", error);
    return NextResponse.json(
      { error: "Failed to enhance image", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
