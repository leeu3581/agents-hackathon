from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import json
import os
from dotenv import load_dotenv
from openai import OpenAI
from aipolabs import ACI, meta_functions
from aipolabs.types.functions import FunctionDefinitionFormat


# Load environment variables
load_dotenv()
LINKED_ACCOUNT_OWNER_ID = os.getenv("LINKED_ACCOUNT_OWNER_ID")
openai = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
aci = ACI(api_key=os.getenv("AIPOLABS_KEY"))

class MessageRequest(BaseModel):
    message: str

prompt = (
    "You are a helpful assistant with access to a variety of tools."
)

tools_meta = [
    meta_functions.ACISearchApps.SCHEMA,
    meta_functions.ACISearchFunctions.SCHEMA,
    meta_functions.ACIGetFunctionDefinition.SCHEMA,
    meta_functions.ACIExecuteFunction.SCHEMA,
]

brave_search_function_definition = aci.functions.get_definition("BRAVE_SEARCH__WEB_SEARCH")

function_defintions = ["BRAVE_SEARCH__NEWS_SEARCH", "BRAVE_SEARCH__WEB_SEARCH", "BRAVE_SEARCH__IMAGE_SEARCH", "BRAVE_SEARCH__VIDEO_SEARCH",
                       "NOTION__GET_PAGE", "NOTION__SEARCH_PAGES",
                       "GMAIL__MESSAGES_LIST", "GMAIL__MESSAGES_GET", "GMAIL__SEND_EMAIL", "GMAIL__THREADS_GET", "GMAIL__THREADS_LIST",
                       "GOOGLE_CALENDAR__CALENDARLIST_GET", "GOOGLE_CALENDAR__CALENDARLIST_LIST", "GOOGLE_CALENDAR__EVENTS_GET", "GOOGLE_CALENDAR__EVENTS_INSERT", "GOOGLE_CALENDAR__EVENTS_LIST", "GOOGLE_CALENDAR__EVENTS_UPDATE", "GOOGLE_CALENDAR__FREEBUSY_QUERY",
                        "SCRAPYBARA__TAKE_SCREENSHOT", "SCRAPYBARA__START_INSTANCE", "SCRAPYBARA__STOP_INSTANCE", "SCRAPYBARA__BROWSER_GET_CURRENT_URL", "SCRAPYBARA__GET_STREAM_URL", "SCRAPYBARA__LIST_ALL_INSTANCES", 
                       ]

function_definitions_list = [aci.functions.get_definition(function_definition) for function_definition in function_defintions]
# print(tools_meta)

tools_retrieved: list[dict] = []


chat_history: list[dict] = []  # Moved outside the message handling loop


while True:
    # Get OpenAI response
    response = openai.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": prompt,
            },
            {
                "role": "user",
                "content": "find top 20 tech investors emails using scrapybara",
            },
        ]
        + chat_history, #last few messages
        tools=function_definitions_list,
    )
    print("H1")
    content = response.choices[0].message.content
    tool_call = (
        response.choices[0].message.tool_calls[0] 
        if response.choices[0].message.tool_calls 
        else None
    )
    print("H2")

    if content:
        chat_history.append({"role": "assistant", "content": content})

    if tool_call:
        print("H3")
        # Send function call progress
        chat_history.append({
            "role": "assistant",
            "tool_calls": [tool_call]
        })
        print(tool_call)

        function_result = aci.handle_function_call(
            tool_call.function.name,
            json.loads(tool_call.function.arguments),
            linked_account_owner_id=LINKED_ACCOUNT_OWNER_ID,
            allowed_apps_only=True,
            format=FunctionDefinitionFormat.OPENAI,
        )

        print("H4")

        function_result_str = json.dumps(function_result, indent=2)

        print("H5")
        chat_history.append({"role": "tool", "tool_call_id": tool_call.id, "content": function_result_str})
