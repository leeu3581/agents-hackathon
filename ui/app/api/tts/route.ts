import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    console.log("Received TTS request"); // Debug log
    const body = await request.json();
    console.log("Request body:", body); // Debug log

    const { text } = body;

    if (!text) {
      console.log("No text provided in request"); // Debug log
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    console.log("Processing text:", text); // Debug log

    // Make into human readable format removing all links. 
    const humanReadableText = text.replace(/https?:\/\/[^\s]+/g, '');

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        voice: 'alloy',
        input: humanReadableText,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error("OpenAI API error:", error); // Debug log
      return NextResponse.json({ error: error.message }, { status: response.status });
    }

    // Get the audio data as ArrayBuffer
    const audioData = await response.arrayBuffer();

    // Return the audio data with appropriate headers
    return new Response(audioData, {
      headers: {
        'Content-Type': 'audio/mpeg',
      },
    });
  } catch (error) {
    console.error("Error generating speech:", error);
    return NextResponse.json({ error: "Failed to generate speech" }, { status: 500 });
  }
}