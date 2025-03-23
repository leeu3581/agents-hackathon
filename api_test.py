from aipolabs import ACI
import os
from dotenv import load_dotenv
from openai import OpenAI
import json

load_dotenv()
# get key from .env fie
key = os.getenv("AIPOLABS_KEY")

aci = ACI(
    # It reads from environment variable by Default
    api_key=key
)

openai = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY")
)

function_definition = aci.functions.get_definition("BRAVE_SEARCH__WEB_SEARCH")
print(function_definition)

response = openai.chat.completions.create(
    model="gpt-4o-mini",
    messages=[
        {"role": "system", "content": "You are a helpful assistant with access to a variety of tools."},
        {"role": "user", "content": "What is aipolabs?"}
    ],
    tools=[function_definition],
    # tool_choice="Required" # Force the model to generate a tool call
)

print(response)

tool_call = (
    response.choices[0].message.tool_calls[0]
    if response.choices[0].message.tool_calls
    else None
)

result = aci.functions.execute(
    tool_call.function.name,
    json.loads(tool_call.function.arguments),
    linked_account_owner_id=os.getenv("BRAVE_LINKED_ACCOUNT_OWNER_ID")
)
print(f"function call result: {result}")
