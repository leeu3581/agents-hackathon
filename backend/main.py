from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import json
import os
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
    "You are a helpful assistant with access to a unlimited number of tools via four meta functions: "
    "ACI_SEARCH_APPS, ACI_SEARCH_FUNCTIONS, ACI_GET_FUNCTION_DEFINITION, and ACI_EXECUTE_FUNCTION."
    "You can use ACI_SEARCH_APPS to find relevant apps (which include a set of functions), if you find Apps that might help with your tasks you can use ACI_SEARCH_FUNCTIONS to find relevant functions within certain apps."
    "You can also use ACI_SEARCH_FUNCTIONS directly to find relevant functions across all apps."
    "Once you have identified the function you need to use, you can use ACI_GET_FUNCTION_DEFINITION to get the definition of the function."
    "You can then use ACI_EXECUTE_FUNCTION to execute the function provided you have the correct input arguments."
    "So the typical order is ACI_SEARCH_APPS -> ACI_SEARCH_FUNCTIONS -> ACI_GET_FUNCTION_DEFINITION -> ACI_EXECUTE_FUNCTION."
)

tools_meta = [
    meta_functions.ACISearchApps.SCHEMA,
    meta_functions.ACISearchFunctions.SCHEMA,
    meta_functions.ACIGetFunctionDefinition.SCHEMA,
    meta_functions.ACIExecuteFunction.SCHEMA,
]

@app.get("/")
async def root():
    return {"message": "WebSocket server is running"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    print("WebSocket connection attempt...")  # Debug log
    await websocket.accept()
    print("WebSocket connection accepted")    # Debug log
    
    try:
        # Receive message from client
        message = await websocket.receive_text()
        print(f"Received message: {message}")  # Debug log
        
        # Send acknowledgment
        await websocket.send_json({
            "type": "progress",
            "content": "Processing your request..."
        })
        chat_history: list[dict] = []
        while True:
            # Get OpenAI response
            response = openai.chat.completions.create(
                model="gpt-4",
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
                tools=tools_meta,
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
                break

    except Exception as e:
        print(f"WebSocket error: {str(e)}")  # Debug log
        try:
            await websocket.send_json({
                "type": "error",
                "content": str(e)
            })
        except:
            pass  # Connection might already be closed
    finally:
        print("WebSocket connection closed")  # Debug log

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        ws='websockets'
    )