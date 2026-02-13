"""
VR for Agents — Python Backend Server
Handles LLM tool calling via Ollama (native /api/chat endpoint)
"""
import json
import traceback
import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional

app = FastAPI(title="VR Agent Backend")

# CORS for frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],    
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- Ollama config ----
OLLAMA_BASE_URL = "http://localhost:11434"
OLLAMA_MODEL = "qwen3:8b"  # Change this to whatever model you have: run 'ollama list' to see


# ---- Catch-all exception handler so CORS headers are always sent ----
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    tb = traceback.format_exc()
    print(f"ERROR: {exc}\n{tb}")
    return JSONResponse(
        status_code=500,
        content={"error": str(exc), "detail": tb},
    )


# ---- Agent function definitions (Ollama tools format) ----
AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "moveTo",
            "description": "Move the agent to specific world coordinates (x, z). The world ranges from roughly -24 to 24.",
            "parameters": {
                "type": "object",
                "properties": {
                    "x": {"type": "number", "description": "X coordinate"},
                    "z": {"type": "number", "description": "Z coordinate"},
                },
                "required": ["x", "z"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "moveForward",
            "description": "Move the agent forward by a given distance in the direction it's currently facing.",
            "parameters": {
                "type": "object",
                "properties": {
                    "distance": {"type": "number", "description": "Distance to move forward"},
                },
                "required": ["distance"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "turnTo",
            "description": "Rotate the agent to face a specific angle in degrees (0=north, 90=east, 180=south, 270=west).",
            "parameters": {
                "type": "object",
                "properties": {
                    "angleDeg": {"type": "number", "description": "Angle in degrees"},
                },
                "required": ["angleDeg"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "lookAt",
            "description": "Turn the agent to face a specific object by its ID.",
            "parameters": {
                "type": "object",
                "properties": {
                    "objectId": {"type": "string", "description": "The object ID to look at"},
                },
                "required": ["objectId"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "interact",
            "description": "Interact with a nearby object by its ID. Must be within 300 units distance.",
            "parameters": {
                "type": "object",
                "properties": {
                    "objectId": {"type": "string", "description": "The object ID to interact with"},
                },
                "required": ["objectId"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "say",
            "description": "Make the agent say something. A speech bubble will appear above the agent.",
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "The text to say"},
                },
                "required": ["text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "done",
            "description": "Call this when the goal has been fully accomplished.",
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string", "description": "Summary of what was accomplished"},
                },
                "required": ["summary"],
            },
        },
    },
]

SYSTEM_PROMPT = """You are an AI agent inside a 3D virtual world. You have a physical body and can move, look around, interact with objects, and speak.

Your current state and what you can see will be provided to you. Use the available functions to accomplish the given goal.

Rules:
- You can only interact with objects within 3 units distance. Move closer first if needed.
- The world coordinates range from -24 to 24 on both X and Z axes.
- You start at position (0, 0).
- Call the 'done' function when you have accomplished your goal.
- Be efficient — don't take unnecessary steps.
- You can call multiple functions in a single turn.
"""

# Store conversation history per session (Ollama messages format)
conversation_history: list[dict] = []


class ThinkRequest(BaseModel):
    api_key: Optional[str] = None  # Not needed for Ollama, kept for frontend compat
    goal: str
    world_state: dict
    agent_state: dict
    step: int


class ThinkResponse(BaseModel):
    thought: Optional[str] = None
    actions: list = []
    done: bool = False


@app.post("/agent/think", response_model=ThinkResponse)
async def agent_think(req: ThinkRequest):
    global conversation_history

    try:
        # Build context message
        context = f"""Current Step: {req.step}
Goal: {req.goal}

Agent State:
- Position: ({req.agent_state.get('position', {}).get('x', 0)}, {req.agent_state.get('position', {}).get('z', 0)})
- Rotation: {req.agent_state.get('rotationDeg', 0)}°
- Status: {req.agent_state.get('state', 'idle')}

World Scan (objects visible):
"""
        objects = req.world_state.get('objects', [])
        for obj in objects:
            context += f"- {obj['id']} ({obj['type']}): {obj.get('description', 'N/A')} at ({obj['position']['x']}, {obj['position']['z']}), distance: {obj.get('distance', '?')} {'[interactable]' if obj.get('interactable') else ''}\n"

        # Reset history on step 0
        if req.step == 0:
            conversation_history = []

        # Add current state to history
        conversation_history.append({
            "role": "user",
            "content": context
        })

        # Build request payload for Ollama native API
        payload = {
            "model": OLLAMA_MODEL,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                *conversation_history
            ],
            "tools": AGENT_TOOLS,
            "stream": False,
        }

        # Call Ollama native API
        async with httpx.AsyncClient(timeout=120.0) as http_client:
            resp = await http_client.post(
                f"{OLLAMA_BASE_URL}/api/chat",
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()

        # Parse response
        thought = None
        actions = []
        is_done = False

        message = data.get("message", {})

        # Extract text content
        if message.get("content"):
            thought = message["content"]

        # Extract tool calls
        tool_calls = message.get("tool_calls", [])
        if tool_calls:
            for tc in tool_calls:
                func = tc.get("function", {})
                func_name = func.get("name", "")
                func_args = func.get("arguments", {})

                if func_name == "done":
                    is_done = True
                    thought = func_args.get("summary", "Goal accomplished")
                else:
                    actions.append({
                        "function": func_name,
                        "args": func_args
                    })

        # Add assistant response to history
        conversation_history.append(message)

        return ThinkResponse(
            thought=thought,
            actions=actions,
            done=is_done
        )

    except httpx.HTTPStatusError as e:
        error_detail = e.response.text if e.response else str(e)
        print(f"Ollama HTTP error: {e.response.status_code} - {error_detail}")
        return ThinkResponse(
            thought=f"Ollama error ({e.response.status_code}): {error_detail}",
            actions=[],
            done=False
        )

    except httpx.ConnectError:
        msg = "Cannot connect to Ollama! Make sure 'ollama serve' is running."
        print(msg)
        return ThinkResponse(thought=msg, actions=[], done=False)

    except Exception as e:
        print(f"Error in agent_think: {e}")
        traceback.print_exc()
        return ThinkResponse(
            thought=f"Error: {str(e)}",
            actions=[],
            done=False
        )


@app.get("/health")
async def health():
    """Health check — also verifies Ollama connectivity and model availability."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as http_client:
            resp = await http_client.get(f"{OLLAMA_BASE_URL}/api/tags")
            resp.raise_for_status()
            models = [m["name"] for m in resp.json().get("models", [])]
            model_found = OLLAMA_MODEL in models
            return {
                "status": "ok" if model_found else "warning",
                "configured_model": OLLAMA_MODEL,
                "model_available": model_found,
                "installed_models": models,
                "message": f"Model '{OLLAMA_MODEL}' {'ready' if model_found else 'NOT FOUND — run: ollama pull ' + OLLAMA_MODEL}",
            }
    except httpx.ConnectError:
        return {
            "status": "error",
            "configured_model": OLLAMA_MODEL,
            "model_available": False,
            "installed_models": [],
            "message": "Cannot connect to Ollama! Run 'ollama serve' first.",
        }


if __name__ == "__main__":
    import uvicorn
    print(f"🚀 Starting VR Agent Backend on http://localhost:8000")
    print(f"🤖 Using Ollama model: {OLLAMA_MODEL}")
    print(f"📡 Ollama endpoint: {OLLAMA_BASE_URL}")
    print("💡 Check model status: http://localhost:8000/health")
    print("📡 Frontend should connect to /agent/think")
    uvicorn.run(app, host="0.0.0.0", port=8000)
