import asyncio
import os

from fastapi import (
    FastAPI,
    WebSocket,
    WebSocketDisconnect,
)

from fastapi.middleware.cors import (
    CORSMiddleware,
)

from dotenv import load_dotenv

load_dotenv()

from agent import run_agent


app = FastAPI(
    title="DevOps AI Agent API",
    version="1.0.0",
)


# --------------------------------------------------
# CORS
# --------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------
# Health check
# --------------------------------------------------

@app.get("/health")
async def health():

    return {
        "status": "ok",
        "service": "devops-ai-agent",
        "model": os.getenv(
            "NVIDIA_MODEL",
            "nvidia/nemotron-3.5-lightning-30b-a3b",
        ),
        "namespace": os.getenv(
            "K8S_NAMESPACE",
            "default",
        ),
    }


# --------------------------------------------------
# Agent WebSocket
# --------------------------------------------------

@app.websocket("/ws/agent")
async def agent_websocket(
    websocket: WebSocket,
):

    await websocket.accept()

    try:

        while True:

            data = (
                await websocket.receive_json()
            )

            question = (
                data
                .get("message", "")
                .strip()
            )

            if not question:

                await websocket.send_json({
                    "type": "error",
                    "message":
                        "Message cannot be empty.",
                })

                continue

            queue: asyncio.Queue = (
                asyncio.Queue()
            )

            loop = (
                asyncio.get_running_loop()
            )

            # -----------------------------------
            # Called from agent background thread
            # -----------------------------------

            def agent_event_callback(
                event: dict,
            ):

                loop.call_soon_threadsafe(
                    queue.put_nowait,
                    event,
                )

            # -----------------------------------
            # Run blocking AI agent in thread
            # -----------------------------------

            async def run_worker():

                try:

                    result = (
                        await asyncio.to_thread(
                            run_agent,
                            question,
                            agent_event_callback,
                        )
                    )

                    await queue.put({
                        "type": "final",
                        "content": result,
                    })

                except Exception as exc:

                    await queue.put({
                        "type": "error",
                        "message": str(exc),
                    })

                finally:

                    await queue.put({
                        "type": "__done__",
                    })

            worker = asyncio.create_task(
                run_worker()
            )

            # -----------------------------------
            # Stream events to React
            # -----------------------------------

            while True:

                event = (
                    await queue.get()
                )

                if (
                    event.get("type")
                    == "__done__"
                ):
                    break

                await websocket.send_json(
                    event
                )

            await worker

    except WebSocketDisconnect:

        print(
            "Frontend disconnected."
        )

    except Exception as exc:

        print(
            f"WebSocket error: {exc}"
        )

        try:

            await websocket.send_json({
                "type": "error",
                "message": str(exc),
            })

        except Exception:
            pass