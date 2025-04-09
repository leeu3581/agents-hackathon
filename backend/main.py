from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import json
import os
import asyncio
import re
from dotenv import load_dotenv
from openai import OpenAI
from aipolabs import ACI, meta_functions
from aipolabs.types.functions import FunctionDefinitionFormat

app = FastAPI()

# Enable CORS - update to include WebSocket
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load environment variables
load_dotenv()
LINKED_ACCOUNT_OWNER_ID = os.getenv("LINKED_ACCOUNT_OWNER_ID")
openai = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
aci = ACI(api_key=os.getenv("AIPOLABS_KEY"))

class MessageRequest(BaseModel):
    message: str

prompt = (
    "You are a source finding agent who finds references and links to sources. "
    "You can use the web search tool to find sources. "
    "If an initial search does not find what the user is looking for, try again with a different query and query parameters. "
    "If you find a source, return the source in a list of dictionaries with the following format: "
    "source_name, source_url, source_type, source_description, source_date"
)

function_defintions = ["BRAVE_SEARCH__NEWS_SEARCH", "BRAVE_SEARCH__WEB_SEARCH", "BRAVE_SEARCH__IMAGE_SEARCH", "BRAVE_SEARCH__VIDEO_SEARCH",
                                             ]

function_definitions_list = [aci.functions.get_definition(function_definition) for function_definition in function_defintions]

from openai import OpenAI
    
grok_client = OpenAI(
  api_key=os.getenv("GROK_API_KEY"),
  base_url="https://api.x.ai/v1",
  organization=os.getenv("OPENAI_ORGANIZATION"),
)

def grok_search(query: str):
    completion = grok_client.chat.completions.create(
        model="grok-2-latest",
        messages=[{
            "role": "user", 
            "content": "does this response give a satisfactory and correct answer to the user's query? If yes, respond with 'yes' ONLY. If no, respond with a new query to search for the correct answer : " + query
        }],
    )
    return completion.choices[0].message.content

@app.get("/")
async def root():
    return {"message": "WebSocket server is running"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    print("WebSocket connection attempt...")
    await websocket.accept()
    print("WebSocket connection accepted")
    
    try:
        while True:  # Keep connection alive
            try:
                # Wait for message with timeout
                message = await asyncio.wait_for(
                    websocket.receive_text(),
                    timeout=60.0  # Disconnect if no message received in 60 seconds
                )
                print(f"Received message: {message}")

                await websocket.send_json({
                    "type": "progress",
                    "content": "Processing your request..."
                })

                chat_history: list[dict] = []
                # Process the conversation
                try:
                    while True:  # Inner conversation loop
                        # Get OpenAI response
                        response = openai.chat.completions.create(
                            model="gpt-4o",
                            messages=[
                                {
                                    "role": "system",
                                    "content": prompt,
                                },
                                {
                                    "role": "user",
                                    "content": message,
                                },
                            ]
                            + chat_history,
                            tools=function_definitions_list,
                        )

                        content = response.choices[0].message.content
                        tool_call = (
                            response.choices[0].message.tool_calls[0] 
                            if response.choices[0].message.tool_calls 
                            else None
                        )
                        if content:
                            await websocket.send_json({
                                "type": "message",
                                "content": content
                            })

                            chat_history.append({"role": "assistant", "content": content})


                        if tool_call:
                            # Send function call progress
                            await websocket.send_json({
                                "type": "progress",
                                "content": f"Function Call: {tool_call.function.name}\nArguments: {tool_call.function.arguments}"
                            })
                            chat_history.append({
                                "role": "assistant",
                                "tool_calls": [tool_call]
                            })

                            function_result = aci.handle_function_call(
                                tool_call.function.name,
                                json.loads(tool_call.function.arguments),
                                linked_account_owner_id=LINKED_ACCOUNT_OWNER_ID,
                                allowed_apps_only=True,
                                format=FunctionDefinitionFormat.OPENAI,
                            )

                            function_result_str = json.dumps(function_result, indent=2)
                        
                            # Send function result
                            await websocket.send_json({
                                "type": "progress",
                                "content": f"Function Result: {function_result_str}"
                            })
                            chat_history.append({"role": "tool", "tool_call_id": tool_call.id, "content": json.dumps(function_result)})

                        else:
                            await websocket.send_json({
                                "type": "final",
                                "content": f"Task Completed"
                            })
                            # Convert chat history messages to string for grok
                            chat_summary = "\n".join([
                                f"{msg.get('role')}: {msg.get('content', '')}" 
                                for msg in chat_history 
                                if msg.get('content')
                            ])
                            response = grok_search(chat_summary)
                            if response == "yes":
                                break
                            else:
                                message = response
                                continue


                except Exception as e:
                    print(f"Error during conversation: {str(e)}")
                    await websocket.send_json({
                        "type": "error",
                        "content": str(e),
                        "chat_history": chat_history
                    })

            except asyncio.TimeoutError:
                print("Client timed out - no message received in 60 seconds")
                break
            except WebSocketDisconnect:
                print("Client disconnected")
                break

    except Exception as e:
        print(f"WebSocket error: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        ws='websockets'
    )