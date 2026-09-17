import os
import json

from openai import OpenAI
from dotenv import load_dotenv



# ---------------------------------------------------------
# Load environment variables
# ---------------------------------------------------------

load_dotenv()


from tools.kubernetes import (
    list_pods,
    describe_pod,
    get_pod_logs,
    get_events,
    get_deployments,
)



# ---------------------------------------------------------
# NVIDIA configuration
# ---------------------------------------------------------

client = OpenAI(
    base_url=os.getenv(
        "NVIDIA_BASE_URL",
        "https://integrate.api.nvidia.com/v1",
    ),
    api_key=os.getenv("NVIDIA_API_KEY"),
)

MODEL = os.getenv(
    "NVIDIA_MODEL",
    "nvidia/nemotron-3.5-lightning-30b-a3b",
)


# ---------------------------------------------------------
# System prompt
# ---------------------------------------------------------

SYSTEM_PROMPT = """
You are a Kubernetes DevOps incident investigation agent.

Your job is to investigate Kubernetes problems using the
provided read-only tools.

Rules:

1. Gather evidence before diagnosing a problem.
2. Use multiple tools when necessary.
3. Never claim that you checked something unless a tool
   actually returned that information.
4. Distinguish confirmed facts from hypotheses.
5. Do not make changes to the Kubernetes cluster.
6. Do not invent Kubernetes output.
7. When you identify an issue, explain:
   - Incident summary
   - Evidence
   - Probable root cause
   - Recommended fix
   - Commands the engineer can manually run
8. If evidence is insufficient, clearly say what additional
   information would be needed.
"""


# ---------------------------------------------------------
# Agent tools
# ---------------------------------------------------------

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "list_pods",
            "description": (
                "List Kubernetes pods in the configured namespace. "
                "Use this when you need to identify pod names, "
                "statuses or restart counts."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "describe_pod",
            "description": (
                "Get detailed Kubernetes information about a pod, "
                "including state, last state, restart count, "
                "events and container information."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "pod_name": {
                        "type": "string",
                        "description": "Exact Kubernetes pod name",
                    }
                },
                "required": ["pod_name"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_pod_logs",
            "description": (
                "Retrieve recent logs from a Kubernetes pod."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "pod_name": {
                        "type": "string",
                    },
                    "container": {
                        "type": ["string", "null"],
                    },
                    "tail_lines": {
                        "type": "integer",
                        "minimum": 10,
                        "maximum": 300,
                    },
                },
                "required": ["pod_name"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_events",
            "description": (
                "Retrieve recent Kubernetes events. "
                "Useful for detecting OOMKilled, scheduling, "
                "image-pull, mount and health-probe problems."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_deployments",
            "description": (
                "List Kubernetes deployments and their current status."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
    },
]


# ---------------------------------------------------------
# Execute tools
# ---------------------------------------------------------

def execute_tool(name: str, arguments: dict):

    if name == "list_pods":
        return list_pods()

    if name == "describe_pod":
        return describe_pod(
            arguments["pod_name"]
        )

    if name == "get_pod_logs":
        return get_pod_logs(
            pod_name=arguments["pod_name"],
            container=arguments.get("container"),
            tail_lines=arguments.get("tail_lines", 100),
        )

    if name == "get_events":
        return get_events()

    if name == "get_deployments":
        return get_deployments()

    return f"Unknown tool requested: {name}"


# ---------------------------------------------------------
# Agent loop
# ---------------------------------------------------------

def run_agent(question: str):

    messages = [
        {
            "role": "system",
            "content": SYSTEM_PROMPT,
        },
        {
            "role": "user",
            "content": question,
        },
    ]

    max_iterations = 8

    for iteration in range(max_iterations):

        print(
            f"\nAgent reasoning cycle {iteration + 1}..."
        )

        response = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            tools=TOOLS,
            tool_choice="auto",
            temperature=0.1,
            max_tokens=4096,
        )

        assistant_message = response.choices[0].message

        messages.append(
            assistant_message.model_dump(
                exclude_none=True
            )
        )

        tool_calls = assistant_message.tool_calls

        # Agent has finished investigating
        if not tool_calls:
            return assistant_message.content

        for tool_call in tool_calls:

            tool_name = tool_call.function.name

            try:
                arguments = json.loads(
                    tool_call.function.arguments
                )
            except json.JSONDecodeError:
                arguments = {}

            print(
                f"Agent selected tool: {tool_name}"
            )

            result = execute_tool(
                tool_name,
                arguments,
            )

            print(
                f"Tool completed: {tool_name}"
            )

            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result,
                }
            )

    return (
        "Investigation reached the maximum number "
        "of tool iterations."
    )