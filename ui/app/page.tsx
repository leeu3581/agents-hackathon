"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Mic, Send, Loader2, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface Message {
  id: string
  content: string
  role: "user" | "assistant" | "progress"
}

// Helper function to format message content
const formatMessageContent = (content: string) => {
  // Split content by newlines
  return content.split('\n').map((line, index) => {
    // Handle bold text with ** markers
    line = line.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    
    // Check if line contains a URL
    const urlRegex = /(https?:\/\/[^\s)]+)/g;
    const parts = line.split(urlRegex);
    
    return (
      <p key={index} className="break-words">
        {parts.map((part, partIndex) => {
          if (part.match(/^https?:\/\//)) {
            return (
              <a
                key={partIndex}
                href={part}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline"
              >
                {part}
              </a>
            );
          } else if (part.match(/<b>([^<]+)<\/b>/)) {
            const [_, text] = part.match(/<b>([^<]+)<\/b>/) || [];
            return <strong key={partIndex}>{text}</strong>;
          }
          return part;
        })}
      </p>
    );
  });
};

// Add visualization of the source chain
const SourceChain = ({ sources }) => {
  return (
    <div className="flex flex-col gap-4">
      {sources.map((source, i) => (
        <div key={i} className="flex items-center">
          <div className="p-4 border rounded">
            <h3>{source.title}</h3>
            <p className="text-sm text-muted-foreground">{source.date}</p>
            <a href={source.url} className="text-blue-500 hover:underline">{source.url}</a>
          </div>
          {i < sources.length - 1 && (
            <div className="h-8 w-8 flex items-center justify-center">
              <ChevronDown className="h-6 w-6" />
            </div>
          )}
        </div>
      ))}
    </div>
  )
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
            // await playTTS(data.content);

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
        // console.log(wsRef.current)
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
      <Card className="w-full max-w-[90vw] h-[80vh] flex flex-col">
        <CardHeader className="border-b py-3">
          <CardTitle className="text-center text-xl">Origins</CardTitle>
        </CardHeader>

        <CardContent 
          ref={chatContainerRef} 
          className="flex-1 overflow-y-auto p-3 space-y-2"
        >
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <div className="text-center space-y-2">
                <p className="text-base">Drop any media to find its source</p>
                <p className="text-xs max-w-md">
                  Supports images, videos, audio, and text. We'll trace back to find where it originated from.
                </p>
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex",
                  message.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "max-w-[90%] rounded-lg px-3 py-2 text-xs",
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : message.role === "progress"
                      ? "bg-muted/50 text-muted-foreground font-mono"
                      : "bg-secondary text-secondary-foreground"
                  )}
                >
                  {formatMessageContent(message.content)}
                </div>
              </div>
            ))
          )}

          {isProcessing && (
            <div className="flex justify-start">
              <div className="max-w-[90%] rounded-lg px-3 py-2 bg-muted/50 font-mono text-xs flex items-center space-x-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Analyzing media...</span>
              </div>
            </div>
          )}
        </CardContent>

        <CardFooter className="border-t p-3">
          <form onSubmit={handleSendMessage} className="flex w-full space-x-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Or paste a URL here..."
              disabled={isRecording || isProcessing}
              className="flex-1 text-xs h-8"
            />

            <Button 
              type="submit" 
              size="icon" 
              className="h-8 w-8"
              disabled={!input.trim() || isRecording || isProcessing}
            >
              <Send className="h-3 w-3" />
            </Button>
          </form>
        </CardFooter>
      </Card>
    </div>
  )
}

