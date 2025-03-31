"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Mic, Send, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface Message {
  id: string
  content: string
  role: "user" | "assistant" | "progress"
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  // Scroll to bottom of chat when messages change
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight
    }
  }, [messages])

  useEffect(() => {
    // Use wss:// for https, ws:// for http
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//localhost:8000/ws`;
    console.log('Connecting to WebSocket:', wsUrl);  // Debug log
    
    wsRef.current = new WebSocket(wsUrl);

    wsRef.current.onopen = () => {
      console.log('WebSocket connection established');  // Debug log
    };

    wsRef.current.onmessage = async (event) => {
      console.log('Received WebSocket message:', event.data);  // Debug log
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'progress':
          setMessages((prev) => [...prev, {
            id: Date.now().toString(),
            content: `🔄 ${data.content}`,
            role: 'progress'
          }]);
          break;

        case 'message':
          setMessages((prev) => [...prev, {
            id: Date.now().toString(),
            content: data.content,
            role: 'assistant'
          }]);
          // Play TTS for regular messages
          if (data.content) {
            console.log("Playing TTS for message:", data.content);
            await playTTS(data.content);

          }
          break;

        case 'final':
          break;

        case 'error':
          console.error('WebSocket error:', data.content);
          setMessages((prev) => [...prev, {
            id: Date.now().toString(),
            content: `❌ Error: ${data.content}`,
            role: 'progress'
          }]);
          break;
      }
    };

    wsRef.current.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    wsRef.current.onclose = () => {
      console.log('WebSocket connection closed');
    };

    // Cleanup on unmount
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!input.trim()) return

    const userMessage: Message = {
      id: Date.now().toString(),
      content: input,
      role: "user",
    }

    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setIsProcessing(true)

    try {
      // Send message through WebSocket
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(input)
      } else {
        throw new Error('WebSocket connection not open')
      }
    } catch (error) {
      console.error("Error sending message:", error)
      setMessages((prev) => [...prev, {
        id: Date.now().toString(),
        content: `❌ Error: ${error}`,
        role: 'progress'
      }])
    } finally {
      setIsProcessing(false)
    }
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioChunksRef.current = []

      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.start()
      setIsRecording(true)
    } catch (error) {
      console.error("Error starting recording:", error)
    }
  }

  const stopRecording = async () => {
    if (!mediaRecorderRef.current) return

    return new Promise<void>((resolve) => {
      if (!mediaRecorderRef.current) {
        resolve()
        return
      }

      mediaRecorderRef.current.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/wav" })
        await sendAudioToApi(audioBlob)
        resolve()
      }

      mediaRecorderRef.current.stop()
      setIsRecording(false)

      // Stop all audio tracks
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop())
    })
  }

  const handleMicButtonDown = () => {
    startRecording()
  }

  const handleMicButtonUp = async () => {
    await stopRecording()
  }

  const sendAudioToApi = async (audioBlob: Blob) => {
    setIsProcessing(true);

    try {
      const formData = new FormData();
      formData.append("audio", audioBlob);

      // Send audio for transcription
      const transcriptionResponse = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });
      const transcriptionData = await transcriptionResponse.json();

      if (!transcriptionResponse.ok) throw new Error(transcriptionData.error);

      // Only proceed if we got valid transcription text
      if (!transcriptionData.text) {
        console.log("No transcription text received - skipping chat");
        return;
      }

      const userMessage: Message = {
        id: Date.now().toString(),
        content: `🎤 ${transcriptionData.text}`,
        role: "user",
      };

      setMessages((prev) => [...prev, userMessage]);

      // Send transcribed text through WebSocket
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(transcriptionData.text);
      } else {
        throw new Error('WebSocket connection not open');
      }
    } catch (error) {
      console.error("Error sending audio:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const playTTS = async (text: string) => {
    try {
      console.log("Sending text to TTS:", text) // Debug log
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json", // Make sure this is set
        },
        body: JSON.stringify({ text }), // Properly stringify the payload
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to generate speech")
      }

      const audioBlob = await response.blob()
      const audioUrl = URL.createObjectURL(audioBlob)
      
      if (audioRef.current) {
        audioRef.current.src = audioUrl
        await audioRef.current.play()
      }
    } catch (error) {
      console.error("Error playing TTS:", error)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4">
      <audio ref={audioRef} className="hidden" />
      <Card className="w-full max-w-md h-[80vh] flex flex-col">
        <CardHeader className="border-b">
          <CardTitle className="text-center">AI Assistant</CardTitle>
        </CardHeader>

        <CardContent ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <p>Ask me anything or hold the mic button to speak</p>
            </div>
          ) : (
            messages.map((message) => (
              <div key={message.id} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[80%] rounded-lg px-4 py-2",
                    message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted",
                  )}
                >
                  {message.content}
                </div>
              </div>
            ))
          )}

          {isProcessing && (
            <div className="flex justify-start">
              <div className="max-w-[80%] rounded-lg px-4 py-2 bg-muted flex items-center space-x-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Processing...</span>
              </div>
            </div>
          )}
        </CardContent>

        <CardFooter className="border-t p-4">
          <form onSubmit={handleSendMessage} className="flex w-full space-x-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message..."
              disabled={isRecording || isProcessing}
              className="flex-1"
            />

            <Button type="submit" size="icon" disabled={!input.trim() || isRecording || isProcessing}>
              <Send className="h-4 w-4" />
            </Button>

            <Button
              type="button"
              size="icon"
              variant={isRecording ? "destructive" : "secondary"}
              className={cn("transition-all", isRecording && "animate-pulse")}
              onMouseDown={handleMicButtonDown}
              onMouseUp={handleMicButtonUp}
              onTouchStart={handleMicButtonDown}
              onTouchEnd={handleMicButtonUp}
              disabled={isProcessing}
            >
              <Mic className="h-4 w-4" />
            </Button>
          </form>
        </CardFooter>
      </Card>
    </div>
  )
}

