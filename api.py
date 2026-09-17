import asyncio
import os

from fastapi import (
    FastAPI,
    HTTPException,
    WebSocket,
    WebSocketDisconnect,
)

from fastapi.middleware.cors import (
    CORSMiddleware,
)

from dotenv import load_dotenv

load_dotenv()

from agent import run_agent
from tools.kubernetes import (
    KubernetesCommandError,
    list_deployments_structured,
    list_events_structured,
    list_nodes_structured,
    list_pods_structured,
)
from tools.prometheus import (
    PrometheusError,
    get_prometheus_dashboard,
)


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
# Read-only Kubernetes resources
# --------------------------------------------------

async def load_kubernetes_resource(loader):
    try:
        return await asyncio.to_thread(loader)
    except KubernetesCommandError as exc:
        raise HTTPException(
            status_code=503,
            detail=str(exc),
        ) from exc


def warning_incidents(events: list[dict]) -> list[dict]:
    critical_reasons = {
        "backoff",
        "crashloopbackoff",
        "evicted",
        "failed",
        "failedscheduling",
        "failedmount",
        "failedattachvolume",
        "imagepullbackoff",
        "oomkilled",
        "unhealthy",
    }

    return [
        {
            **event,
            "severity": (
                "critical"
                if event.get("reason", "").lower() in critical_reasons
                else "warning"
            ),
        }
        for event in events
        if event.get("type", "").lower() == "warning"
    ]

@app.get("/api/pods")
async def pods():
    data = await load_kubernetes_resource(list_pods_structured)

    return {
        "data": data,
        "count": len(data),
    }


@app.get("/api/deployments")
async def deployments():
    data = await load_kubernetes_resource(list_deployments_structured)

    return {
        "data": data,
        "count": len(data),
    }


@app.get("/api/nodes")
async def nodes():
    data = await load_kubernetes_resource(list_nodes_structured)

    return {
        "data": data,
        "count": len(data),
    }


@app.get("/api/events")
async def events():
    data = await load_kubernetes_resource(list_events_structured)

    return {
        "data": data,
        "count": len(data),
    }


@app.get("/api/workloads")
async def workloads():
    try:
        pods_data, deployments_data = await asyncio.gather(
            asyncio.to_thread(list_pods_structured),
            asyncio.to_thread(list_deployments_structured),
        )
    except KubernetesCommandError as exc:
        raise HTTPException(
            status_code=503,
            detail=str(exc),
        ) from exc

    return {
        "pods": pods_data,
        "deployments": deployments_data,
        "count": len(pods_data) + len(deployments_data),
    }


@app.get("/api/incidents")
async def incidents():
    events_data = await load_kubernetes_resource(list_events_structured)
    data = warning_incidents(events_data)

    return {
        "data": data,
        "count": len(data),
    }


@app.get("/api/overview")
async def overview():
    try:
        pods_data, deployments_data, nodes_data, events_data = await asyncio.gather(
            asyncio.to_thread(list_pods_structured),
            asyncio.to_thread(list_deployments_structured),
            asyncio.to_thread(list_nodes_structured),
            asyncio.to_thread(list_events_structured),
        )
    except KubernetesCommandError as exc:
        raise HTTPException(
            status_code=503,
            detail=str(exc),
        ) from exc

    incidents_data = warning_incidents(events_data)

    return {
        "namespace": os.getenv("K8S_NAMESPACE", "default"),
        "pods": {
            "total": len(pods_data),
            "healthy": sum(
                1 for pod in pods_data if pod.get("status") == "Running"
            ),
            "restarts": sum(
                pod.get("restart_count", 0) for pod in pods_data
            ),
        },
        "deployments": {
            "total": len(deployments_data),
            "available": sum(
                1
                for deployment in deployments_data
                if deployment.get("status") == "Available"
            ),
        },
        "nodes": {
            "total": len(nodes_data),
            "ready": sum(
                1 for node in nodes_data if node.get("status") == "Ready"
            ),
        },
        "incidents": {
            "total": len(incidents_data),
            "critical": sum(
                1
                for incident in incidents_data
                if incident.get("severity") == "critical"
            ),
        },
        "recent_events": events_data[:8],
    }


# --------------------------------------------------
# Read-only Prometheus metrics
# --------------------------------------------------

@app.get("/api/metrics")
async def metrics(window: str = "1h"):
    try:
        return await asyncio.to_thread(
            get_prometheus_dashboard,
            window,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc
    except PrometheusError as exc:
        raise HTTPException(
            status_code=503,
            detail=str(exc),
        ) from exc


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
