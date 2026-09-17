import json
import os
import subprocess

NAMESPACE = os.getenv("K8S_NAMESPACE", "default")
KUBECONFIG = os.getenv(
    "KUBECONFIG",
    os.path.expanduser("~/.kube/config"),
)

MAX_OUTPUT = 30000


class KubernetesCommandError(RuntimeError):
    """Raised when a read-only kubectl request cannot be completed."""


def run_kubectl(args: list[str]) -> str:
    command = [
        "kubectl",
        "--kubeconfig",
        KUBECONFIG,
        "--request-timeout=20s",
        *args,
    ]

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=30,
        )

        output = (
            result.stdout.strip()
            if result.returncode == 0
            else result.stderr.strip()
        )

        if not output:
            output = "Command completed but returned no output."

        return output[:MAX_OUTPUT]

    except subprocess.TimeoutExpired:
        return "kubectl command timed out."

    except Exception as exc:
        return f"kubectl error: {str(exc)}"


def run_kubectl_json(args: list[str]) -> dict:
    """Run a read-only kubectl command and decode its JSON response."""
    command = [
        "kubectl",
        "--kubeconfig",
        KUBECONFIG,
        "--request-timeout=20s",
        *args,
    ]

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except subprocess.TimeoutExpired as exc:
        raise KubernetesCommandError("kubectl command timed out.") from exc
    except Exception as exc:
        raise KubernetesCommandError(f"kubectl error: {exc}") from exc

    if result.returncode != 0:
        error_lines = [
            line.strip()
            for line in result.stderr.splitlines()
            if line.strip()
        ]
        message = error_lines[-1] if error_lines else "kubectl command failed."
        raise KubernetesCommandError(message[:1000])

    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise KubernetesCommandError(
            "kubectl returned an invalid JSON response."
        ) from exc


def _pod_status(pod: dict) -> str:
    metadata = pod.get("metadata", {})
    status = pod.get("status", {})

    if metadata.get("deletionTimestamp"):
        return "Terminating"

    for container_status in status.get("containerStatuses") or []:
        state = container_status.get("state") or {}
        waiting_reason = (state.get("waiting") or {}).get("reason")
        terminated_reason = (state.get("terminated") or {}).get("reason")

        if waiting_reason:
            return waiting_reason

        if terminated_reason and terminated_reason != "Completed":
            return terminated_reason

    return status.get("phase") or "Unknown"


def parse_pods_json(payload: dict) -> list[dict]:
    """Convert Kubernetes pod objects into the dashboard's stable schema."""
    pods = []

    for pod in payload.get("items") or []:
        metadata = pod.get("metadata") or {}
        spec = pod.get("spec") or {}
        status = pod.get("status") or {}
        containers = spec.get("containers") or []
        container_statuses = status.get("containerStatuses") or []

        pods.append({
            "name": metadata.get("name", ""),
            "namespace": metadata.get("namespace", NAMESPACE),
            "phase": status.get("phase") or "Unknown",
            "status": _pod_status(pod),
            "ready_containers": sum(
                1 for container in container_statuses if container.get("ready")
            ),
            "total_containers": len(containers),
            "restart_count": sum(
                int(container.get("restartCount") or 0)
                for container in container_statuses
            ),
            "node": spec.get("nodeName"),
            "pod_ip": status.get("podIP"),
            "start_time": status.get("startTime"),
            "images": [
                container.get("image", "")
                for container in containers
                if container.get("image")
            ],
        })

    return pods


def list_pods_structured() -> list[dict]:
    payload = run_kubectl_json([
        "get", "pods",
        "-n", NAMESPACE,
        "-o", "json",
    ])

    return parse_pods_json(payload)


def parse_deployments_json(payload: dict) -> list[dict]:
    deployments = []

    for deployment in payload.get("items") or []:
        metadata = deployment.get("metadata") or {}
        spec = deployment.get("spec") or {}
        status = deployment.get("status") or {}
        pod_template = (spec.get("template") or {}).get("spec") or {}
        containers = pod_template.get("containers") or []
        desired = int(spec.get("replicas") or 0)
        ready = int(status.get("readyReplicas") or 0)
        available = int(status.get("availableReplicas") or 0)
        unavailable = int(status.get("unavailableReplicas") or 0)

        if desired == 0:
            deployment_status = "Scaled down"
        elif unavailable > 0:
            deployment_status = "Degraded"
        elif ready >= desired and available >= desired:
            deployment_status = "Available"
        else:
            deployment_status = "Progressing"

        selector = (spec.get("selector") or {}).get("matchLabels") or {}

        deployments.append({
            "name": metadata.get("name", ""),
            "namespace": metadata.get("namespace", NAMESPACE),
            "status": deployment_status,
            "replicas": desired,
            "ready_replicas": ready,
            "available_replicas": available,
            "updated_replicas": int(status.get("updatedReplicas") or 0),
            "unavailable_replicas": unavailable,
            "images": [
                container.get("image", "")
                for container in containers
                if container.get("image")
            ],
            "selector": selector,
            "created_at": metadata.get("creationTimestamp"),
        })

    return deployments


def list_deployments_structured() -> list[dict]:
    payload = run_kubectl_json([
        "get", "deployments",
        "-n", NAMESPACE,
        "-o", "json",
    ])

    return parse_deployments_json(payload)


def parse_nodes_json(payload: dict) -> list[dict]:
    nodes = []

    for node in payload.get("items") or []:
        metadata = node.get("metadata") or {}
        spec = node.get("spec") or {}
        status = node.get("status") or {}
        labels = metadata.get("labels") or {}
        node_info = status.get("nodeInfo") or {}
        conditions = status.get("conditions") or []
        addresses = status.get("addresses") or []
        ready_condition = next(
            (condition for condition in conditions if condition.get("type") == "Ready"),
            {},
        )
        roles = [
            key.removeprefix("node-role.kubernetes.io/") or "worker"
            for key in labels
            if key.startswith("node-role.kubernetes.io/")
        ]
        internal_ip = next(
            (
                address.get("address")
                for address in addresses
                if address.get("type") == "InternalIP"
            ),
            None,
        )

        nodes.append({
            "name": metadata.get("name", ""),
            "status": "Ready" if ready_condition.get("status") == "True" else "NotReady",
            "roles": roles or ["worker"],
            "version": node_info.get("kubeletVersion"),
            "internal_ip": internal_ip,
            "os": node_info.get("osImage"),
            "architecture": node_info.get("architecture"),
            "container_runtime": node_info.get("containerRuntimeVersion"),
            "unschedulable": bool(spec.get("unschedulable", False)),
            "created_at": metadata.get("creationTimestamp"),
        })

    return nodes


def list_nodes_structured() -> list[dict]:
    payload = run_kubectl_json([
        "get", "nodes",
        "-o", "json",
    ])

    return parse_nodes_json(payload)


def parse_events_json(payload: dict) -> list[dict]:
    events = []

    for event in payload.get("items") or []:
        metadata = event.get("metadata") or {}
        regarding = event.get("regarding") or event.get("involvedObject") or {}
        source = event.get("reportingController") or (
            (event.get("source") or {}).get("component")
        )
        series = event.get("series") or {}
        last_time = (
            series.get("lastObservedTime")
            or event.get("eventTime")
            or event.get("lastTimestamp")
            or event.get("firstTimestamp")
            or metadata.get("creationTimestamp")
        )

        events.append({
            "id": metadata.get("uid") or (
                f"{metadata.get('namespace', NAMESPACE)}/"
                f"{metadata.get('name', '')}"
            ),
            "namespace": metadata.get("namespace", NAMESPACE),
            "type": event.get("type") or "Normal",
            "reason": event.get("reason") or "Unknown",
            "object_kind": regarding.get("kind") or "Object",
            "object_name": regarding.get("name") or "Unknown",
            "message": event.get("note") or event.get("message") or "",
            "count": int(series.get("count") or event.get("count") or 1),
            "first_time": (
                event.get("firstTimestamp")
                or metadata.get("creationTimestamp")
            ),
            "last_time": last_time,
            "source": source or "Kubernetes",
        })

    return sorted(
        events,
        key=lambda item: item.get("last_time") or "",
        reverse=True,
    )


def list_events_structured() -> list[dict]:
    payload = run_kubectl_json([
        "get", "events",
        "-n", NAMESPACE,
        "-o", "json",
    ])

    return parse_events_json(payload)


def list_pods():
    return run_kubectl([
        "get", "pods",
        "-n", NAMESPACE,
        "-o", "wide",
    ])


def describe_pod(pod_name: str):
    return run_kubectl([
        "describe", "pod",
        pod_name,
        "-n", NAMESPACE,
    ])


def get_pod_logs(
    pod_name: str,
    container: str | None = None,
    tail_lines: int = 100,
):
    tail_lines = max(10, min(tail_lines, 300))

    args = [
        "logs",
        pod_name,
        "-n", NAMESPACE,
        "--tail", str(tail_lines),
    ]

    if container:
        args.extend(["-c", container])

    return run_kubectl(args)


def get_previous_pod_logs(
    pod_name: str,
    container: str | None = None,
    tail_lines: int = 200,
):
    tail_lines = max(10, min(tail_lines, 300))

    args = [
        "logs",
        pod_name,
        "-n", NAMESPACE,
        "--previous",
        "--tail", str(tail_lines),
    ]

    if container:
        args.extend(["-c", container])

    return run_kubectl(args)


def get_events():
    return run_kubectl([
        "get", "events",
        "-n", NAMESPACE,
        "--sort-by=.lastTimestamp",
    ])


def get_deployments():
    return run_kubectl([
        "get", "deployments",
        "-n", NAMESPACE,
        "-o", "wide",
    ])


def get_deployment(deployment_name: str):
    return run_kubectl([
        "get",
        "deployment",
        deployment_name,
        "-n",
        NAMESPACE,
        "-o",
        "yaml",
    ])


def describe_node(node_name: str):
    return run_kubectl([
        "describe",
        "node",
        node_name,
    ])


def get_pod_metrics():
    return run_kubectl([
        "top",
        "pods",
        "-n",
        NAMESPACE,
    ])


def get_node_metrics():
    return run_kubectl([
        "top",
        "nodes",
    ])
