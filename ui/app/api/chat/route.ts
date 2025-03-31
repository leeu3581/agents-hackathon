import { NextResponse } from "next/server"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    console.log("Received request body:", body) // Debug log

    const { message } = body

    if (!message) {
      console.log("No message found in request") // Debug log
      return NextResponse.json({ error: "No message provided" }, { status: 400 })
    }

    console.log("Sending message to OpenAI:", message) // Debug log

    const response = await fetch('http://localhost:8000/process', {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message }),
    });

    if (!response.ok) {
      const errorData = await response.json()
      console.error("localhost:8000 error:", errorData) // Debug log
      return NextResponse.json(
        { error: errorData.detail || "Failed to process message" },
        { status: response.status }
      )
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error processing message:", error)
    return NextResponse.json({ error: "Failed to process message" }, { status: 500 })
  }
}

