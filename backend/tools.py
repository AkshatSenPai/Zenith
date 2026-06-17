"""Zenith — tool registry. Add a tool = add a schema + an executor (+ name in
ACTION_TOOLS if it acts). Nothing else in the codebase changes."""

import datetime


def _get_current_time(_input: dict) -> str:
    now = datetime.datetime.now().astimezone()
    return now.strftime("%A, %d %B %Y, %I:%M %p %Z")


def _send_message(tool_input: dict) -> str:
    to = tool_input.get("to", "?")
    body = tool_input.get("body", "")
    return f"Message to {to} sent (stub): {body!r}"


TOOLS = [
    {
        "name": "get_current_time",
        "description": "Get the current local date and time. Use when the user asks what time or date it is.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "send_message",
        "description": "Send a text message to a person. Use when the user asks to message, text, or tell someone something.",
        "input_schema": {
            "type": "object",
            "properties": {
                "to": {"type": "string", "description": "Recipient name or number"},
                "body": {"type": "string", "description": "The message text to send"},
            },
            "required": ["to", "body"],
        },
    },
]

ACTION_TOOLS = {"send_message"}   # require user confirmation before running

_EXECUTORS = {
    "get_current_time": _get_current_time,
    "send_message": _send_message,
}


def run_tool(name: str, tool_input: dict) -> str:
    executor = _EXECUTORS.get(name)
    result = executor(tool_input or {}) if executor else f"Error: unknown tool {name!r}."
    print(f"[tool] {name}({tool_input}) -> {result}")   # the log line (DONE WHEN evidence)
    return result
