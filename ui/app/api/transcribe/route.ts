import { NextResponse } from "next/server"

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const audioFile = formData.get("audio") as File

    if (!audioFile) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 })
    }

    // In a real implementation, you would send this to a speech-to-text service
    // For example, using OpenAI's Whisper API:
 
    // const formData = new FormData();
    formData.append('file', audioFile);
    formData.append('model', 'whisper-1');
    
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: formData
    });
    
    const data = await response.json();
    return NextResponse.json({ text: data.text });
  

    // // For demo purposes, we'll just return a mock response
    // return NextResponse.json({
    //   text: "This is a simulated transcription of your voice message.",
    // })
  } catch (error) {
    console.error("Error processing audio:", error)
    return NextResponse.json({ error: "Failed to process audio" }, { status: 500 })
  }
}

