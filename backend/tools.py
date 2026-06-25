"""Zenith — tool registry. Add a tool = add a schema + an executor (+ name in
ACTION_TOOLS if it acts). Nothing else in the codebase changes.

Milestone 3 adds Google Calendar + Gmail + weather + a morning briefing. The executors are
thin: they call the `google_service` / `weather_service` layers and format a short string for
Claude. Read-only tools run inline; the action tools (create/update/delete event, send_email)
flow through the EXISTING confirm gate — they're just listed in ACTION_TOOLS.
"""

import datetime as dt

import activity_log
import discord_service
import google_service
import weather_service


# ---------- existing stub tools ----------

def _get_current_time(_input: dict) -> str:
    now = dt.datetime.now().astimezone()
    return now.strftime("%A, %d %B %Y, %I:%M %p %Z")


def _send_message(tool_input: dict) -> str:
    to = tool_input.get("to", "?")
    body = tool_input.get("body", "")
    return f"Message to {to} sent (stub): {body!r}"


# ---------- formatting helpers ----------

def _fmt_time(iso: str) -> str:
    try:
        return dt.datetime.fromisoformat(iso.replace("Z", "+00:00")).strftime("%H:%M")
    except Exception:  # noqa: BLE001
        return iso


def _event_line(e: dict) -> str:
    when = "all day" if e.get("all_day") else f"{_fmt_time(e['start'])}-{_fmt_time(e['end'])}"
    loc = f" @ {e['location']}" if e.get("location") else ""
    return f"- {when}: {e['title']}{loc} [id:{e['id']}]"


def _email_line(m: dict) -> str:
    flag = "● " if m.get("unread") else "  "
    snippet = (m.get("snippet") or "").strip()[:90]
    return f"{flag}{m['from']} — {m['subject']} :: {snippet} [id:{m['id']}]"


# ---------- calendar executors ----------

def _get_calendar_events(i: dict) -> str:
    when = i.get("when", "today")
    events = google_service.get_events(when=when)
    if not events:
        return f"No events for {when}."
    return f"Events ({when}):\n" + "\n".join(_event_line(e) for e in events)


def _search_calendar(i: dict) -> str:
    events = google_service.search_calendar(i.get("query", ""))
    if not events:
        return "No matching upcoming events."
    return "Matching events:\n" + "\n".join(_event_line(e) for e in events)


def _create_event(i: dict) -> str:
    if not i.get("summary") or not i.get("start"):
        return "create_event needs at least a summary and a start datetime (ISO 8601)."
    e = google_service.create_event(
        summary=i["summary"],
        start=i["start"],
        end=i.get("end"),
        duration_min=i.get("duration_min", 60),
        location=i.get("location"),
        description=i.get("description"),
        attendees=i.get("attendees"),
    )
    return f"Created '{e['title']}' starting {e['start']} (id {e['id']})."


def _update_event(i: dict) -> str:
    if not i.get("event_id"):
        return "update_event needs the event_id (get it from get_calendar_events first)."
    e = google_service.update_event(
        event_id=i["event_id"],
        summary=i.get("summary"),
        start=i.get("start"),
        end=i.get("end"),
        location=i.get("location"),
        description=i.get("description"),
        attendees=i.get("attendees"),
    )
    return f"Updated '{e['title']}' — now {e['start']} to {e['end']} (id {e['id']})."


def _delete_event(i: dict) -> str:
    if not i.get("event_id"):
        return "delete_event needs the event_id (get it from get_calendar_events first)."
    google_service.delete_event(i["event_id"])
    return f"Deleted event {i['event_id']}."


# ---------- gmail executors ----------

def _get_emails(i: dict) -> str:
    filt = i.get("filter", "recent")
    msgs = google_service.get_emails(filter=filt, max_results=int(i.get("max", 10)))
    if not msgs:
        return "No unread emails." if filt == "unread" else "No emails found."
    label = "Unread" if filt == "unread" else "Recent"
    return f"{label} emails:\n" + "\n".join(_email_line(m) for m in msgs)


def _search_emails(i: dict) -> str:
    msgs = google_service.search_emails(i.get("query", ""), max_results=int(i.get("max", 10)))
    if not msgs:
        return "No matching emails."
    return "Matching emails:\n" + "\n".join(_email_line(m) for m in msgs)


def _read_email(i: dict) -> str:
    if not i.get("id"):
        return "read_email needs the message id (get it from get_emails/search_emails)."
    m = google_service.read_email(i["id"])
    return f"From: {m['from']}\nDate: {m['date']}\nSubject: {m['subject']}\n\n{m['body'][:1500]}"


def _send_email(i: dict) -> str:
    if not i.get("to") or not i.get("body"):
        return "send_email needs at least 'to' and 'body'."
    s = google_service.send_email(to=i["to"], subject=i.get("subject", ""), body=i["body"])
    return f"Email sent to {s['to']} (subject: {s['subject'] or '(none)'})."


# ---------- weather + briefing ----------

def _get_weather(i: dict) -> str:
    w = weather_service.get_weather(i.get("location"))
    return (
        f"{w['location']}: {w['condition']}, {w['temp_c']}°C "
        f"(feels {w['feels_like_c']}°C; {w['temp_min_c']}–{w['temp_max_c']}°C, humidity {w['humidity']}%)."
    )


def build_briefing(location: str | None = None) -> str:
    """Assemble today's events + unread mail + weather into one block for Claude to narrate.
    Each section degrades on its own so a disconnected/unkeyed service never blanks the rest."""
    lines: list[str] = []

    try:
        events = google_service.get_events("today")
        lines.append("Today's schedule:")
        lines += [_event_line(e) for e in events] if events else ["- nothing on the calendar"]
    except google_service.NotConnected:
        lines.append("Calendar: not connected.")

    try:
        unread = google_service.get_emails("unread", max_results=5)
        if unread:
            lines.append(f"\nUnread email ({len(unread)} shown):")
            lines += [_email_line(m) for m in unread]
        else:
            lines.append("\nNo unread email.")
    except google_service.NotConnected:
        lines.append("\nEmail: not connected.")

    try:
        w = weather_service.get_weather(location)
        lines.append(f"\nWeather in {w['location']}: {w['condition']}, {w['temp_c']}°C (feels {w['feels_like_c']}°C).")
    except weather_service.WeatherUnavailable as exc:
        lines.append(f"\nWeather: {exc}")

    return "\n".join(lines)


def _get_briefing(i: dict) -> str:
    return build_briefing(i.get("location"))


# ---------- discord executors ----------

def _list_discord_channels(_i: dict) -> str:
    servers = discord_service.list_channels()
    if not servers:
        return "The bot isn't in any servers yet — invite it (see SETUP-DISCORD.md)."
    lines = []
    for s in servers:
        chans = ", ".join("#" + c["name"] for c in s["channels"]) or "(no readable channels)"
        lines.append(f"{s['guild']}: {chans}")
    return "Discord servers / channels:\n" + "\n".join(lines)


def _discord_line(m: dict) -> str:
    return f"- [{_fmt_time(m['time'])}] {m['author']}: {m['text']} [id:{m['id']}]"


def _get_discord_messages(i: dict) -> str:
    if not i.get("channel"):
        return "get_discord_messages needs a channel (e.g. #general)."
    msgs = discord_service.get_messages(i["channel"], int(i.get("limit", 15)))
    chan = str(i["channel"]).lstrip("#")
    if not msgs:
        return f"No recent messages in #{chan}."
    return f"#{chan} (recent):\n" + "\n".join(_discord_line(m) for m in msgs)


def _search_discord_messages(i: dict) -> str:
    if not i.get("query"):
        return "search_discord_messages needs a query."
    hits = discord_service.search_messages(i["query"], i.get("channel"))
    if not hits:
        return "No matching Discord messages."
    return "Matching Discord messages:\n" + "\n".join(
        f"- #{m['channel']} {m['author']}: {m['text']} [id:{m['id']}]" for m in hits
    )


def _send_discord_message(i: dict) -> str:
    if not i.get("channel") or not i.get("text"):
        return "send_discord_message needs a channel and text."
    s = discord_service.send_message(i["channel"], i["text"])
    return f"Posted to #{s['channel']} in {s['guild']}."


# ---------- registry ----------

_ISO_HINT = "ISO 8601 local datetime, e.g. 2026-06-26T16:00:00"

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
    {
        "name": "get_calendar_events",
        "description": "Read Google Calendar events. Use for 'what's on my calendar', 'am I free', 'my schedule'.",
        "input_schema": {
            "type": "object",
            "properties": {
                "when": {
                    "type": "string",
                    "description": "today (default), tomorrow, a date YYYY-MM-DD, or a range YYYY-MM-DD..YYYY-MM-DD",
                }
            },
            "required": [],
        },
    },
    {
        "name": "search_calendar",
        "description": "Search upcoming Google Calendar events by text.",
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "Text to search for"}},
            "required": ["query"],
        },
    },
    {
        "name": "create_event",
        "description": "Create a Google Calendar event. The user confirms before it is created.",
        "input_schema": {
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "Event title"},
                "start": {"type": "string", "description": _ISO_HINT},
                "end": {"type": "string", "description": f"End ({_ISO_HINT}). Optional if duration_min is given."},
                "duration_min": {"type": "integer", "description": "Length in minutes if no end is given (default 60)"},
                "location": {"type": "string"},
                "description": {"type": "string"},
                "attendees": {"type": "array", "items": {"type": "string"}, "description": "Attendee email addresses"},
            },
            "required": ["summary", "start"],
        },
    },
    {
        "name": "update_event",
        "description": "Edit/reschedule an existing event. Get the event_id from get_calendar_events first. User confirms.",
        "input_schema": {
            "type": "object",
            "properties": {
                "event_id": {"type": "string"},
                "summary": {"type": "string"},
                "start": {"type": "string", "description": _ISO_HINT},
                "end": {"type": "string", "description": _ISO_HINT},
                "location": {"type": "string"},
                "description": {"type": "string"},
                "attendees": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["event_id"],
        },
    },
    {
        "name": "delete_event",
        "description": "Delete/cancel a calendar event. Get the event_id from get_calendar_events first. User confirms.",
        "input_schema": {
            "type": "object",
            "properties": {"event_id": {"type": "string"}},
            "required": ["event_id"],
        },
    },
    {
        "name": "get_emails",
        "description": "Read recent or unread Gmail messages (summaries: from, subject, snippet, id).",
        "input_schema": {
            "type": "object",
            "properties": {
                "filter": {"type": "string", "enum": ["recent", "unread"], "description": "default recent"},
                "max": {"type": "integer", "description": "How many to return (default 10)"},
            },
            "required": [],
        },
    },
    {
        "name": "search_emails",
        "description": "Search Gmail with Gmail search syntax, e.g. 'from:rahul newer_than:7d', 'subject:invoice'.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Gmail search query"},
                "max": {"type": "integer", "description": "default 10"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "read_email",
        "description": "Read the full body of one email by id (get the id from get_emails/search_emails).",
        "input_schema": {
            "type": "object",
            "properties": {"id": {"type": "string", "description": "Gmail message id"}},
            "required": ["id"],
        },
    },
    {
        "name": "send_email",
        "description": "Send an email via Gmail. The user confirms before it sends.",
        "input_schema": {
            "type": "object",
            "properties": {
                "to": {"type": "string", "description": "Recipient email address"},
                "subject": {"type": "string"},
                "body": {"type": "string"},
            },
            "required": ["to", "subject", "body"],
        },
    },
    {
        "name": "get_weather",
        "description": "Current weather for a location (defaults to the user's configured location).",
        "input_schema": {
            "type": "object",
            "properties": {"location": {"type": "string", "description": "City, e.g. 'Hyderabad,IN'"}},
            "required": [],
        },
    },
    {
        "name": "get_briefing",
        "description": "Morning briefing: today's events + unread email + weather, assembled for you to narrate "
        "concisely. Use for 'good morning', 'brief me', 'what's my day look like'.",
        "input_schema": {
            "type": "object",
            "properties": {"location": {"type": "string", "description": "Optional weather location override"}},
            "required": [],
        },
    },
    {
        "name": "list_discord_channels",
        "description": "List the Discord servers + text channels the bot can see (server channels only, never DMs). "
        "Use to discover channel names.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_discord_messages",
        "description": "Read recent messages from a Discord server channel the bot is in (not DMs).",
        "input_schema": {
            "type": "object",
            "properties": {
                "channel": {"type": "string", "description": "Channel name, e.g. #general or general"},
                "limit": {"type": "integer", "description": "How many recent messages (default 15, max 50)"},
            },
            "required": ["channel"],
        },
    },
    {
        "name": "search_discord_messages",
        "description": "Search recent Discord messages for text, optionally within one channel.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "channel": {"type": "string", "description": "Optional channel to limit the search"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "send_discord_message",
        "description": "Post a message to a Discord server channel. The user confirms before it sends.",
        "input_schema": {
            "type": "object",
            "properties": {
                "channel": {"type": "string", "description": "Channel name, e.g. #team"},
                "text": {"type": "string"},
            },
            "required": ["channel", "text"],
        },
    },
]

# Action tools require user confirmation before running (the existing confirm gate).
ACTION_TOOLS = {"send_message", "create_event", "update_event", "delete_event", "send_email", "send_discord_message"}

_EXECUTORS = {
    "get_current_time": _get_current_time,
    "send_message": _send_message,
    "get_calendar_events": _get_calendar_events,
    "search_calendar": _search_calendar,
    "create_event": _create_event,
    "update_event": _update_event,
    "delete_event": _delete_event,
    "get_emails": _get_emails,
    "search_emails": _search_emails,
    "read_email": _read_email,
    "send_email": _send_email,
    "get_weather": _get_weather,
    "get_briefing": _get_briefing,
    "list_discord_channels": _list_discord_channels,
    "get_discord_messages": _get_discord_messages,
    "search_discord_messages": _search_discord_messages,
    "send_discord_message": _send_discord_message,
}


def _activity_target(name: str, i: dict) -> str:
    """A short detail for the activity log entry (event title, recipient, query…)."""
    if name in ("create_event", "update_event"):
        return i.get("summary", "")
    if name == "delete_event":
        return "event"
    if name in ("send_email", "send_message"):
        return i.get("to", "")
    if name == "get_calendar_events":
        return i.get("when", "today")
    if name == "get_emails":
        return i.get("filter", "recent")
    if name in ("search_calendar", "search_emails"):
        return i.get("query", "")
    if name in ("send_discord_message", "get_discord_messages"):
        return "#" + str(i.get("channel", "")).lstrip("#")
    if name == "search_discord_messages":
        return i.get("query", "")
    return ""


def run_tool(name: str, tool_input: dict) -> str:
    tool_input = tool_input or {}
    executor = _EXECUTORS.get(name)
    failed = False
    if executor is None:
        result, failed = f"Error: unknown tool {name!r}.", True
    else:
        try:
            result = executor(tool_input)
            # disconnected / validation results are plain strings — don't log them as real work
            if result.lstrip().startswith(("Not connected", "Weather unavailable")) or " needs " in result:
                failed = True
        except google_service.NotConnected as exc:
            result, failed = str(exc), True
        except weather_service.WeatherUnavailable as exc:
            result, failed = str(exc), True
        except (discord_service.DiscordNotConnected, discord_service.DiscordChannelNotFound) as exc:
            result, failed = str(exc), True
        except Exception as exc:  # noqa: BLE001 — a tool error must never 500 the chat route
            result, failed = f"Sorry, the {name} call failed: {exc}", True
    if not failed:
        activity_log.record(name, _activity_target(name, tool_input))
    print(f"[tool] {name}({tool_input}) -> {str(result)[:200]}")   # the log line (DONE WHEN evidence)
    return result
