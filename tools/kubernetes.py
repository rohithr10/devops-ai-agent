import os
import subprocess

NAMESPACE = os.getenv("K8S_NAMESPACE", "default")
KUBECONFIG = os.getenv(
    "KUBECONFIG",
    os.path.expanduser("~/.kube/config"),
)

MAX_OUTPUT = 30000


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