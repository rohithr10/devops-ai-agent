import json
import math
import os
import ssl
import time
from datetime import UTC, datetime
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


PROMETHEUS_URL = os.getenv(
    "PROMETHEUS_URL",
    "http://localhost:9090",
).rstrip("/")
PROMETHEUS_BEARER_TOKEN = os.getenv("PROMETHEUS_BEARER_TOKEN", "")
PROMETHEUS_VERIFY_SSL = os.getenv(
    "PROMETHEUS_VERIFY_SSL",
    "true",
).lower() not in {"0", "false", "no"}

WINDOWS = {
    "15m": 15 * 60,
    "1h": 60 * 60,
    "6h": 6 * 60 * 60,
    "24h": 24 * 60 * 60,
}

CPU_USAGE_QUERY = (
    'sum(rate(container_cpu_usage_seconds_total{container!="",image!=""}[5m]))'
)
CPU_CAPACITY_QUERY = "sum(machine_cpu_cores)"
MEMORY_USAGE_QUERY = (
    'sum(container_memory_working_set_bytes{container!="",image!=""})'
)
MEMORY_CAPACITY_QUERY = "sum(machine_memory_bytes)"
CPU_PERCENT_QUERY = f"100 * ({CPU_USAGE_QUERY}) / ({CPU_CAPACITY_QUERY})"
MEMORY_PERCENT_QUERY = (
    f"100 * ({MEMORY_USAGE_QUERY}) / ({MEMORY_CAPACITY_QUERY})"
)
TOP_POD_CPU_QUERY = (
    'topk(8, sum by (namespace, pod) '
    '(rate(container_cpu_usage_seconds_total{container!="",image!=""}[5m])))'
)
TOP_POD_MEMORY_QUERY = (
    'topk(8, sum by (namespace, pod) '
    '(container_memory_working_set_bytes{container!="",image!=""}))'
)


class PrometheusError(RuntimeError):
    """Raised when Prometheus cannot return a valid query response."""


def _ssl_context():
    if PROMETHEUS_VERIFY_SSL:
        return None

    return ssl._create_unverified_context()


def _request(path: str, params: dict) -> dict:
    url = f"{PROMETHEUS_URL}{path}?{urlencode(params)}"
    headers = {"Accept": "application/json"}

    if PROMETHEUS_BEARER_TOKEN:
        headers["Authorization"] = f"Bearer {PROMETHEUS_BEARER_TOKEN}"

    request = Request(url, headers=headers, method="GET")

    try:
        with urlopen(
            request,
            timeout=12,
            context=_ssl_context(),
        ) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise PrometheusError(
            f"Prometheus returned HTTP {exc.code}."
        ) from exc
    except URLError as exc:
        reason = getattr(exc, "reason", exc)
        raise PrometheusError(f"Unable to reach Prometheus: {reason}") from exc
    except (TimeoutError, json.JSONDecodeError) as exc:
        raise PrometheusError(
            "Prometheus returned an invalid or timed-out response."
        ) from exc

    if payload.get("status") != "success":
        message = payload.get("error") or "Prometheus query failed."
        raise PrometheusError(str(message))

    return payload.get("data") or {}


def query(query_text: str) -> list[dict]:
    data = _request(
        "/api/v1/query",
        {"query": query_text},
    )
    return data.get("result") or []


def query_range(
    query_text: str,
    start: float,
    end: float,
    step: int,
) -> list[dict]:
    data = _request(
        "/api/v1/query_range",
        {
            "query": query_text,
            "start": f"{start:.0f}",
            "end": f"{end:.0f}",
            "step": step,
        },
    )
    return data.get("result") or []


def _number(value) -> float:
    try:
        number = float(value)
        return number if math.isfinite(number) else 0.0
    except (TypeError, ValueError):
        return 0.0


def _scalar(results: list[dict]) -> float:
    if not results:
        return 0.0

    value = results[0].get("value") or []
    return _number(value[1] if len(value) > 1 else 0)


def _history(results: list[dict]) -> list[dict]:
    if not results:
        return []

    values = results[0].get("values") or []
    return [
        {
            "timestamp": int(_number(point[0])),
            "value": round(_number(point[1]), 3),
        }
        for point in values
        if len(point) > 1
    ]


def _pod_values(results: list[dict], multiplier: float = 1.0) -> dict:
    values = {}

    for result in results:
        metric = result.get("metric") or {}
        pod = metric.get("pod")
        namespace = metric.get("namespace") or "default"
        value = result.get("value") or []

        if not pod:
            continue

        values[(namespace, pod)] = (
            _number(value[1] if len(value) > 1 else 0) * multiplier
        )

    return values


def get_prometheus_dashboard(window: str = "1h") -> dict:
    if window not in WINDOWS:
        allowed = ", ".join(WINDOWS)
        raise ValueError(f"Unsupported window. Choose one of: {allowed}.")

    end = time.time()
    duration = WINDOWS[window]
    start = end - duration
    step = max(15, duration // 60)

    cpu_usage = _scalar(query(CPU_USAGE_QUERY))
    cpu_capacity = _scalar(query(CPU_CAPACITY_QUERY))
    memory_usage = _scalar(query(MEMORY_USAGE_QUERY))
    memory_capacity = _scalar(query(MEMORY_CAPACITY_QUERY))
    targets_up = _scalar(query("sum(up == 1)"))
    targets_total = _scalar(query("count(up)"))
    cpu_history = _history(
        query_range(CPU_PERCENT_QUERY, start, end, step)
    )
    memory_history = _history(
        query_range(MEMORY_PERCENT_QUERY, start, end, step)
    )
    pod_cpu = _pod_values(query(TOP_POD_CPU_QUERY), multiplier=1000)
    pod_memory = _pod_values(query(TOP_POD_MEMORY_QUERY))
    pod_keys = set(pod_cpu) | set(pod_memory)
    top_pods = [
        {
            "namespace": namespace,
            "pod": pod,
            "cpu_millicores": round(pod_cpu.get((namespace, pod), 0), 3),
            "memory_bytes": round(pod_memory.get((namespace, pod), 0)),
        }
        for namespace, pod in pod_keys
    ]
    top_pods.sort(
        key=lambda item: (
            item["cpu_millicores"],
            item["memory_bytes"],
        ),
        reverse=True,
    )

    return {
        "provider": "Prometheus",
        "window": window,
        "generated_at": datetime.now(UTC).isoformat(),
        "summary": {
            "cpu_usage_cores": round(cpu_usage, 4),
            "cpu_capacity_cores": round(cpu_capacity, 4),
            "cpu_usage_percent": round(
                (cpu_usage / cpu_capacity * 100) if cpu_capacity else 0,
                3,
            ),
            "memory_usage_bytes": round(memory_usage),
            "memory_capacity_bytes": round(memory_capacity),
            "memory_usage_percent": round(
                (memory_usage / memory_capacity * 100)
                if memory_capacity
                else 0,
                3,
            ),
            "targets_up": round(targets_up),
            "targets_total": round(targets_total),
        },
        "history": {
            "cpu_percent": cpu_history,
            "memory_percent": memory_history,
        },
        "top_pods": top_pods[:10],
    }
