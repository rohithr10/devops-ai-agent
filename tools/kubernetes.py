import os
import subprocess


NAMESPACE = os.getenv("K8S_NAMESPACE", "default")

KUBECONFIG = os.getenv(
    "KUBECONFIG",
    os.path.expanduser("~/.kube/config"),
)

MAX_OUTPUT = 20_000


def run_kubectl(args: list[str]) -> str:

    command = [
        "kubectl",
        "--kubeconfig",
        KUBECONFIG,
        "--request-timeout=15s",
        *args,
    ]

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=20,
        )

        if result.returncode != 0:
            return result.stderr.strip()

        return result.stdout.strip()

    except subprocess.TimeoutExpired:
        return "kubectl command timed out."

    except Exception as exc:
        return f"kubectl error: {str(exc)}"
def list_pods():
    return run_kubectl([
        "get",
        "pods",
        "-n",
        NAMESPACE,
        "-o",
        "wide",
    ])


def describe_pod(pod_name: str):
    return run_kubectl([
        "describe",
        "pod",
        pod_name,
        "-n",
        NAMESPACE,
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
        "-n",
        NAMESPACE,
        "--tail",
        str(tail_lines),
    ]

    if container:
        args.extend([
            "-c",
            container,
        ])

    return run_kubectl(args)


def get_events():
    return run_kubectl([
        "get",
        "events",
        "-n",
        NAMESPACE,
        "--sort-by=.lastTimestamp",
    ])


def get_deployments():
    return run_kubectl([
        "get",
        "deployments",
        "-n",
        NAMESPACE,
        "-o",
        "wide",
    ])