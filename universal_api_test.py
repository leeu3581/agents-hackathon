import json
import os

from dotenv import load_dotenv
from openai import OpenAI

from aipolabs import ACI, meta_functions
from aipolabs.types.functions import FunctionDefinitionFormat
from aipolabs.utils._logging import create_headline

load_dotenv()
LINKED_ACCOUNT_OWNER_ID = os.getenv("LINKED_ACCOUNT_OWNER_ID", "")
if not LINKED_ACCOUNT_OWNER_ID:
    raise ValueError("LINKED_ACCOUNT_OWNER_ID is not set")

# gets OPENAI_API_KEY from your environment variables
openai = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
# gets AIPOLABS_ACI_API_KEY from your environment variables
aci = ACI(api_key=os.getenv("AIPOLABS_KEY"))

prompt = (
    "You are a helpful assistant with access to a unlimited number of tools via four meta functions: "
    "ACI_SEARCH_APPS, ACI_SEARCH_FUNCTIONS, ACI_GET_FUNCTION_DEFINITION, and ACI_EXECUTE_FUNCTION."
    "You can use ACI_SEARCH_APPS to find relevant apps (which include a set of functions), if you find Apps that might help with your tasks you can use ACI_SEARCH_FUNCTIONS to find relevant functions within certain apps."
    "You can also use ACI_SEARCH_FUNCTIONS directly to find relevant functions across all apps."
    "Once you have identified the function you need to use, you can use ACI_GET_FUNCTION_DEFINITION to get the definition of the function."
    "You can then use ACI_EXECUTE_FUNCTION to execute the function provided you have the correct input arguments."
    "So the typical order is ACI_SEARCH_APPS -> ACI_SEARCH_FUNCTIONS -> ACI_GET_FUNCTION_DEFINITION -> ACI_EXECUTE_FUNCTION."
)

# aipolabs meta functions for the LLM to discover the available executale functions dynamically
tools_meta = [
    meta_functions.ACISearchApps.SCHEMA,
    meta_functions.ACISearchFunctions.SCHEMA,
    meta_functions.ACIGetFunctionDefinition.SCHEMA,
    meta_functions.ACIExecuteFunction.SCHEMA,
]


def main() -> None:
    # Start the LLM processing loop
    chat_history: list[dict] = []

    while True:
        print(create_headline("Waiting for LLM Output"))
        response = openai.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": prompt,
                },
                {
                    "role": "user",
                    "content": "Can you use brave search to find top 5 results about aipolabs ACI?", #Can you use brave search to find top 5 results about aipolabs ACI?
                },
            ]
            + chat_history,
            tools=tools_meta,
            # tool_choice="required",  # force the model to generate a tool call
            parallel_tool_calls=False,
        )

        # Process LLM response and potential function call (there can only be at most one function call)
        content = response.choices[0].message.content
        tool_call = (
            response.choices[0].message.tool_calls[0]
            if response.choices[0].message.tool_calls
            else None
        )
        if content:
            print(f"{create_headline('LLM Message')} \n {content}")
            chat_history.append({"role": "assistant", "content": content})

        # Handle function call if any
        if tool_call:
            print(
                f"{create_headline(f'Function Call: {tool_call.function.name}')} \n arguments: {tool_call.function.arguments}"
            )

            chat_history.append({"role": "assistant", "tool_calls": [tool_call]})
            result = aci.handle_function_call(
                tool_call.function.name,
                json.loads(tool_call.function.arguments),
                linked_account_owner_id=LINKED_ACCOUNT_OWNER_ID,
                allowed_apps_only=True,
                format=FunctionDefinitionFormat.OPENAI,
            )

            print(f"{create_headline('Function Call Result')} \n {result}")
            # Continue loop, feeding the result back to the LLM for further instructions
            chat_history.append(
                {"role": "tool", "tool_call_id": tool_call.id, "content": json.dumps(result)}
            )
        else:
            # If there's no further function call, exit the loop
            print(create_headline("Task Completed"))
            break


if __name__ == "__main__":
    main()