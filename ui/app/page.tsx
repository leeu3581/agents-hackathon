"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Send, Loader2, Calendar, ExternalLink, User, Menu } from "lucide-react"
import { cn } from "@/lib/utils"
import Image from "next/image"
import { format, parseISO } from "date-fns"

interface Source {
  type?: string
  title: string
  url: string
  page_age: string
  description?: string
  profile?: {
    name: string
    img: string
  }
  media_outlet?: string
  reputation?: number // Added reputation field
}

interface Message {
  id: string
  content: string
  role: "user" | "assistant" | "progress"
}

// Add a function to get reputation for media outlets
const getReputationForOutlet = (outlet?: string): number => {
  if (!outlet) return 3

  const reputationMap: Record<string, number> = {
    "scientificamerican.com": 5,
    "nature.com": 5,
    "science.org": 5,
    "forbes.com": 4,
    "nytimes.com": 4,
    "washingtonpost.com": 4,
    "bbc.com": 4,
    "nationalgeographic.com": 4,
    "smithsonianmag.com": 4,
    "cnn.com": 3,
    "foxnews.com": 3,
    "usatoday.com": 3,
    "buzzfeed.com": 2,
    "dailymail.co.uk": 2,
    "nypost.com": 2,
  }

  // Try to match the outlet with entries in our map
  for (const [domain, rating] of Object.entries(reputationMap)) {
    if (outlet.includes(domain)) {
      return rating
    }
  }

  return 3 // Default rating for unknown outlets
}

// Add a function to get color for source type
const getSourceTypeColor = (type?: string): string => {
  if (!type) return "bg-gray-500"

  const typeColorMap: Record<string, string> = {
    news_result: "bg-blue-500",
    academic_result: "bg-purple-500",
    blog_result: "bg-green-500",
    video_result: "bg-red-500",
    image_result: "bg-amber-500",
    social_result: "bg-pink-500",
    forum_result: "bg-teal-500",
    book_result: "bg-indigo-500",
    document_result: "bg-cyan-500",
  }

  return typeColorMap[type] || "bg-gray-500"
}

// Add a function to render reputation stars
const ReputationStars = ({ rating }: { rating: number }) => {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <div
          key={star}
          className={`w-2 h-2 rounded-full ${star <= rating ? "bg-yellow-400" : "bg-gray-300 dark:bg-gray-600"}`}
        />
      ))}
    </div>
  )
}

// Helper function to format message content
const formatMessageContent = (content: string) => {
  // Split content by newlines
  return content.split("\n").map((line, index) => {
    // Handle bold text with ** markers
    line = line.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")

    // Check if line contains a URL
    const urlRegex = /(https?:\/\/[^\s)]+)/g
    const parts = line.split(urlRegex)

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
            )
          } else if (part.match(/<b>([^<]+)<\/b>/)) {
            const [_, text] = part.match(/<b>([^<]+)<\/b>/) || []
            return <strong key={partIndex}>{text}</strong>
          }
          return part
        })}
      </p>
    )
  })
}

// Extract sources from progress messages
const extractSources = (messages: Message[]): Source[] => {
  const sources: Source[] = []
  messages.forEach((message) => {
    if (message.role === "progress" && message.content.includes("Function Result:")) {
      try {
        // console.log("Extracting sources from message:", message.content)
        // Extract the JSON part from the message
        const jsonMatch = message.content.match(/Function Result: ({[\s\S]*})/)
        if (jsonMatch && jsonMatch[1]) {
          const resultData = JSON.parse(jsonMatch[1])
          console.log("Parsed JSON:", resultData)
          if (resultData.data.results) {
            resultData.data.results.forEach((result: any) => {
              sources.push({
                type: result.type,                
                title: result.title,
                url: result.url,
                page_age: result.page_age,
                description: result.description,
                profile: result.profile,
                media_outlet: result.meta_url.hostname,
                reputation: getReputationForOutlet(result.meta_url.hostname),
              })
            })
          } 
        }
      } catch (error) {
        console.error("Error parsing source data:", error)
      }
    }
  })

  // Sort sources by page_age
  return sources.sort((a, b) => {
    return new Date(a.page_age).getTime() - new Date(b.page_age).getTime()
  })
}

// Format date for display
const formatDate = (dateString: string) => {
  try {
    const date = parseISO(dateString)
    return format(date, "MMM d, yyyy")
  } catch (error) {
    return dateString
  }
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [sources, setSources] = useState<Source[]>([])
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
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

  // Update sources when messages change
  useEffect(() => {
    const extractedSources = extractSources(messages)
    setSources(extractedSources)
  }, [messages])

  useEffect(() => {
    // Use wss:// for https, ws:// for http
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const wsUrl = `${protocol}//localhost:8000/ws`
    console.log("Connecting to WebSocket:", wsUrl)

    wsRef.current = new WebSocket(wsUrl)

    wsRef.current.onopen = () => {
      console.log("WebSocket connection established")
    }

    wsRef.current.onmessage = async (event) => {
      console.log("Received WebSocket message:", event.data)
      const data = JSON.parse(event.data)

      switch (data.type) {
        case "progress":
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now().toString(),
              content: `🔄 ${data.content}`,
              role: "progress",
            },
          ])
          break

        case "message":
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now().toString(),
              content: data.content,
              role: "assistant",
            },
          ])
          // Play TTS for regular messages
          if (data.content) {
            console.log("Playing TTS for message:", data.content)
            // await playTTS(data.content);
          }
          break

        case "final":
          break

        case "error":
          console.error("WebSocket error:", data.content)
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now().toString(),
              content: `❌ Error: ${data.content}`,
              role: "progress",
            },
          ])
          break
      }
    }

    wsRef.current.onerror = (error) => {
      console.error("WebSocket error:", error)
    }

    wsRef.current.onclose = () => {
      console.log("WebSocket connection closed")
    }

    // Cleanup on unmount
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [])

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
        throw new Error("WebSocket connection not open")
      }
    } catch (error) {
      console.error("Error sending message:", error)
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          content: `❌ Error: ${error}`,
          role: "progress",
        },
      ])
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
    setIsProcessing(true)

    try {
      const formData = new FormData()
      formData.append("audio", audioBlob)

      // Send audio for transcription
      const transcriptionResponse = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      })
      const transcriptionData = await transcriptionResponse.json()

      if (!transcriptionResponse.ok) throw new Error(transcriptionData.error)

      // Only proceed if we got valid transcription text
      if (!transcriptionData.text) {
        console.log("No transcription text received - skipping chat")
        return
      }

      const userMessage: Message = {
        id: Date.now().toString(),
        content: `🎤 ${transcriptionData.text}`,
        role: "user",
      }

      setMessages((prev) => [...prev, userMessage])

      // Send transcribed text through WebSocket
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(transcriptionData.text)
      } else {
        throw new Error("WebSocket connection not open")
      }
    } catch (error) {
      console.error("Error sending audio:", error)
    } finally {
      setIsProcessing(false)
    }
  }

  const playTTS = async (text: string) => {
    try {
      console.log("Sending text to TTS:", text)
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
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
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="border-b px-4 py-3 flex items-center justify-between bg-card">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="relative h-8 w-8">
              <Image
                src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Toothless-PNG-High-Quality-Image-Qzc0svjCohb6aODng8DR6qaJXSPZeW.png"
                alt="Origins Logo"
                fill
                className="object-contain"
              />
            </div>
            <h1 className="text-xl font-bold hidden sm:block">Origins</h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="hidden sm:flex gap-1 items-center">
            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            <span className="text-xs">Connected</span>
          </Badge>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="text-xs gap-1 hidden md:flex">
              <User className="h-3 w-3" />
              <span>Elisa</span>
            </Button>
            <Avatar className="h-8 w-8 border">
              <User className="h-5 w-5 text-muted-foreground" />
            </Avatar>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Main chat area */}
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <div className="relative h-24 w-24 mb-4">
                  <Image
                    src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Toothless-PNG-High-Quality-Image-Qzc0svjCohb6aODng8DR6qaJXSPZeW.png"
                    alt="Origins Logo"
                    fill
                    className="object-contain"
                  />
                </div>
                <div className="text-center space-y-2">
                  <h2 className="text-xl font-bold">Welcome to Origins</h2>
                  <p className="text-base">Ask any question to find reliable sources</p>
                  <p className="text-xs max-w-md">Drop any media or paste a URL to trace back to its original source</p>
                </div>
              </div>
            ) : (
              messages.map((message) => (
                <div key={message.id} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-lg px-4 py-2 text-sm",
                      message.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : message.role === "progress"
                          ? "bg-muted/50 text-muted-foreground font-mono text-xs"
                          : "bg-secondary text-secondary-foreground",
                    )}
                  >
                    {formatMessageContent(message.content)}
                  </div>
                </div>
              ))
            )}

            {isProcessing && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-lg px-4 py-2 bg-muted/50 font-mono text-xs flex items-center space-x-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Analyzing sources...</span>
                </div>
              </div>
            )}
          </div>

          <audio ref={audioRef} className="hidden" />

          <div className="border-t p-4">
            <form onSubmit={handleSendMessage} className="flex w-full space-x-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about any topic or paste a URL..."
                disabled={isRecording || isProcessing}
                className="flex-1"
              />

              <Button type="submit" size="icon" disabled={!input.trim() || isRecording || isProcessing}>
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>

        {/* Sources panel - hidden on mobile, shown on larger screens */}
        <div className="w-80 border-l bg-card hidden md:block overflow-y-auto">
          <div className="p-4 border-b">
            <h2 className="font-semibold">Source Timeline</h2>
            <p className="text-xs text-muted-foreground">Chronological order of references</p>
          </div>

          <div className="p-4">
            {sources.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm">No sources found yet</p>
                <p className="text-xs mt-1">Sources will appear here as they're discovered</p>
              </div>
            ) : (
              <div className="space-y-6">
                {sources.map((source, index) => (
                  <div key={index} className="relative">
                    {index > 0 && <div className="absolute left-3 top-0 h-full w-0.5 bg-muted -translate-y-1/2"></div>}
                    <div className="relative z-10 flex items-start gap-3">
                      <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs">
                        {index + 1}
                      </div>
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          <span>{formatDate(source.page_age)}</span>
                        </div>
                        <div className="text-sm font-medium line-clamp-2">{source.title}</div>
                        {source.type && (
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full text-white ${getSourceTypeColor(source.type)}`}
                            >
                              {source.type}
                            </span>
                          </div>
                        )}
                        {source.media_outlet && (
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">{source.media_outlet}</span>
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-muted-foreground">Reputation:</span>
                              <ReputationStars rating={getReputationForOutlet(source.media_outlet)} />
                            </div>
                          </div>
                        )}
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-500 hover:underline flex items-center gap-1"
                        >
                          <ExternalLink className="h-3 w-3" />
                          View Source
                        </a>
                        {source.description && (
                          <div
                            className="text-xs text-muted-foreground mt-1 line-clamp-3"
                            dangerouslySetInnerHTML={{ __html: source.description }}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile sources panel (slide-in) */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 md:hidden">
          <div className="fixed right-0 top-0 h-full w-3/4 bg-card border-l shadow-lg">
            <div className="p-4 border-b flex items-center justify-between">
              <h2 className="font-semibold">Source Timeline</h2>
              <Button variant="ghost" size="sm" onClick={() => setIsMobileMenuOpen(false)}>
                ✕
              </Button>
            </div>

            {/* Update the mobile sources panel to match the desktop version */}
            <div className="p-4 overflow-y-auto max-h-[calc(100vh-4rem)]">
              {sources.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p className="text-sm">No sources found yet</p>
                  <p className="text-xs mt-1">Sources will appear here as they're discovered</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {sources.map((source, index) => (
                    <div key={index} className="relative">
                      {index > 0 && (
                        <div className="absolute left-3 top-0 h-full w-0.5 bg-muted -translate-y-1/2"></div>
                      )}
                      <div className="relative z-10 flex items-start gap-3">
                        <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs">
                          {index + 1}
                        </div>
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            <span>{formatDate(source.page_age)}</span>
                          </div>
                          <div className="text-sm font-medium line-clamp-2">{source.title}</div>
                          {source.type && (
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-xs px-2 py-0.5 rounded-full text-white ${getSourceTypeColor(source.type)}`}
                              >
                                {source.type}
                              </span>
                            </div>
                          )}
                          {source.media_outlet && (
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">{source.media_outlet}</span>
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-muted-foreground">Reputation:</span>
                                <ReputationStars rating={getReputationForOutlet(source.media_outlet)} />
                              </div>
                            </div>
                          )}
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-500 hover:underline flex items-center gap-1"
                          >
                            <ExternalLink className="h-3 w-3" />
                            View Source
                          </a>
                          {source.description && (
                            <div
                              className="text-xs text-muted-foreground mt-1 line-clamp-3"
                              dangerouslySetInnerHTML={{ __html: source.description }}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
