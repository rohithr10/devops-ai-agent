import { useEffect, useRef, useState } from "react";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  Activity,
  AlertTriangle,
  Bot,
  Box,
  CheckCircle2,
  Circle,
  CloudCog,
  Cpu,
  Database,
  LoaderCircle,
  Send,
  Server,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  User,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";

import "./index.css";

type ConnectionStatus = "connecting" | "connected" | "disconnected";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type ActivityItem = {
  id: string;
  tool: string;
  status: "running" | "completed" | "failed";
};

type AgentEvent = {
  type: string;
  id?: string;
  tool?: string;
  cycle?: number;
  content?: string;
  message?: string;
  error?: string;
};

const toolLabels: Record<string, string> = {
  list_pods: "Discovering Kubernetes pods",
  describe_pod: "Inspecting pod configuration",
  get_pod_logs: "Reading current pod logs",
  get_previous_pod_logs: "Reading previous container logs",
  get_events: "Checking Kubernetes events",
  get_deployments: "Discovering deployments",
  get_deployment: "Inspecting deployment configuration",
  describe_node: "Inspecting Kubernetes node",
  get_pod_metrics: "Checking pod resource usage",
  get_node_metrics: "Checking node resource usage",
};

function generateId() {
  return `${Date.now()}-${Math.random()}`;
}

function App() {
  const socketRef = useRef<WebSocket | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting");

  const [messages, setMessages] = useState<Message[]>([]);

  const [activities, setActivities] = useState<ActivityItem[]>([]);

  const [input, setInput] = useState("");

  const [isRunning, setIsRunning] = useState(false);

  const [cycle, setCycle] = useState(0);

  // ------------------------------------------------
  // WebSocket
  // ------------------------------------------------

  useEffect(() => {
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (!active) {
        return;
      }

      setConnectionStatus("connecting");

      const wsUrl =
        import.meta.env.VITE_WS_URL || "ws://localhost:8000/ws/agent";

      const socket = new WebSocket(wsUrl);

      socketRef.current = socket;

      socket.onopen = () => {
        if (!active) {
          return;
        }

        setConnectionStatus("connected");
      };

      socket.onmessage = (event) => {
        const data: AgentEvent = JSON.parse(event.data);

        handleAgentEvent(data);
      };

      socket.onerror = () => {
        setConnectionStatus("disconnected");
      };

      socket.onclose = () => {
        if (!active) {
          return;
        }

        setConnectionStatus("disconnected");

        retryTimer = setTimeout(connect, 2000);
      };
    };

    connect();

    return () => {
      active = false;

      if (retryTimer) {
        clearTimeout(retryTimer);
      }

      socketRef.current?.close();
    };
  }, []);

  // ------------------------------------------------
  // Auto scroll
  // ------------------------------------------------

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages, activities]);

  // ------------------------------------------------
  // Handle backend events
  // ------------------------------------------------

  const handleAgentEvent = (event: AgentEvent) => {
    switch (event.type) {
      case "agent_started":
        setIsRunning(true);
        setActivities([]);
        setCycle(1);

        break;

      case "cycle":
        setCycle(event.cycle ?? 0);

        break;

      case "tool_started":
        if (!event.id || !event.tool) {
          return;
        }

        setActivities((current) => [
          ...current,
          {
            id: event.id!,
            tool: event.tool!,
            status: "running",
          },
        ]);

        break;

      case "tool_completed":
        setActivities((current) =>
          current.map((item) =>
            item.id === event.id
              ? {
                  ...item,
                  status: "completed",
                }
              : item,
          ),
        );

        break;

      case "tool_failed":
        setActivities((current) =>
          current.map((item) =>
            item.id === event.id
              ? {
                  ...item,
                  status: "failed",
                }
              : item,
          ),
        );

        break;

      case "final":
        setMessages((current) => [
          ...current,
          {
            id: generateId(),
            role: "assistant",
            content: event.content || "Investigation completed.",
          },
        ]);

        setIsRunning(false);

        break;

      case "error":
        setMessages((current) => [
          ...current,
          {
            id: generateId(),
            role: "assistant",
            content: `⚠️ Agent error: ${
              event.message || event.error || "Unknown error"
            }`,
          },
        ]);

        setIsRunning(false);

        break;
    }
  };

  // ------------------------------------------------
  // Send question
  // ------------------------------------------------

  const sendMessage = () => {
    const question = input.trim();

    if (!question || isRunning || connectionStatus !== "connected") {
      return;
    }

    setMessages((current) => [
      ...current,
      {
        id: generateId(),
        role: "user",
        content: question,
      },
    ]);

    setActivities([]);
    setCycle(0);
    setIsRunning(true);

    socketRef.current?.send(
      JSON.stringify({
        message: question,
      }),
    );

    setInput("");
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="app-shell">
      {/* Sidebar */}

      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <CloudCog size={22} />
          </div>

          <div>
            <div className="brand-name">KubeAgent</div>

            <div className="brand-subtitle">AI Operations</div>
          </div>
        </div>

        <nav className="nav">
          <div className="nav-label">WORKSPACE</div>

          <button className="nav-item active">
            <Sparkles size={18} />
            AI Copilot
          </button>

          <button className="nav-item">
            <Activity size={18} />
            Overview
          </button>

          <button className="nav-item">
            <Box size={18} />
            Workloads
          </button>

          <div className="nav-label second">KUBERNETES</div>

          <button className="nav-item">
            <Server size={18} />
            Nodes
          </button>

          <button className="nav-item">
            <Box size={18} />
            Pods
          </button>

          <button className="nav-item">
            <Database size={18} />
            Deployments
          </button>

          <div className="nav-label second">OPERATIONS</div>

          <button className="nav-item">
            <AlertTriangle size={18} />
            Incidents
          </button>

          <button className="nav-item">
            <TerminalSquare size={18} />
            Activity
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="secure-card">
            <ShieldCheck size={19} />

            <div>
              <strong>Read-only mode</strong>

              <span>No cluster mutations</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}

      <main className="main-area">
        <header className="topbar">
          <div>
            <h1>AI DevOps Copilot</h1>

            <p>Investigate your Kubernetes cluster using natural language</p>
          </div>

          <div className={`connection-badge ${connectionStatus}`}>
            {connectionStatus === "connected" ? (
              <Wifi size={15} />
            ) : (
              <WifiOff size={15} />
            )}

            {connectionStatus}
          </div>
        </header>

        <div className="workspace">
          {/* Chat */}

          <section className="chat-panel">
            <div className="chat-scroll">
              {messages.length === 0 && <Welcome />}

              {messages.map((message) => (
                <div key={message.id} className={`message ${message.role}`}>
                  <div className="avatar">
                    {message.role === "user" ? (
                      <User size={17} />
                    ) : (
                      <Bot size={17} />
                    )}
                  </div>

                  <div className="message-body">
                    <div className="message-name">
                      {message.role === "user" ? "You" : "KubeAgent"}
                    </div>

                    <div className="message-content">
                      {message.role === "assistant" ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {message.content}
                        </ReactMarkdown>
                      ) : (
                        <p>{message.content}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {isRunning && (
                <div className="message assistant">
                  <div className="avatar agent">
                    <Bot size={17} />
                  </div>

                  <div className="message-body">
                    <div className="message-name">KubeAgent</div>

                    <div className="investigating">
                      <LoaderCircle size={17} className="spin" />
                      Investigating cluster
                      {cycle > 0 && ` · cycle ${cycle}`}
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            <div className="composer-wrap">
              <div className="composer">
                <Sparkles size={18} className="composer-icon" />

                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    connectionStatus === "connected"
                      ? "Ask about your Kubernetes cluster..."
                      : "Connecting to agent..."
                  }
                  disabled={connectionStatus !== "connected"}
                />

                <button
                  className="send-button"
                  onClick={sendMessage}
                  disabled={
                    isRunning ||
                    !input.trim() ||
                    connectionStatus !== "connected"
                  }
                >
                  {isRunning ? (
                    <LoaderCircle size={18} className="spin" />
                  ) : (
                    <Send size={18} />
                  )}
                </button>
              </div>

              <div className="composer-note">
                Read-only Kubernetes access · Powered by NVIDIA Nemotron
              </div>
            </div>
          </section>

          {/* Right panel */}

          <aside className="right-panel">
            <div className="side-card">
              <div className="card-title">
                <Activity size={17} />
                Agent Activity
              </div>

              {activities.length === 0 ? (
                <div className="empty-activity">
                  <Circle size={27} />

                  <p>Agent activity will appear here.</p>
                </div>
              ) : (
                <div className="activity-list">
                  {activities.map((item) => (
                    <div key={item.id} className="activity-row">
                      <ActivityStatus status={item.status} />

                      <div>
                        <div className="activity-name">
                          {toolLabels[item.tool] ?? item.tool}
                        </div>

                        <div className="activity-tool">{item.tool}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="side-card">
              <div className="card-title">
                <Cpu size={17} />
                Agent Runtime
              </div>

              <div className="runtime-grid">
                <RuntimeItem label="Model" value="Nemotron 3.5" />

                <RuntimeItem label="Mode" value="Read-only" />

                <RuntimeItem
                  label="Kubernetes"
                  value={
                    connectionStatus === "connected" ? "Connected" : "Offline"
                  }
                />

                <RuntimeItem label="Interface" value="WebSocket" />
              </div>
            </div>

            <div className="side-card safety">
              <ShieldCheck size={20} />

              <div>
                <strong>Safe investigation</strong>

                <p>
                  This version can inspect your cluster but cannot restart,
                  delete or modify workloads.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function Welcome() {
  return (
    <div className="welcome">
      <div className="welcome-icon">
        <Sparkles size={30} />
      </div>

      <h2>What should I investigate?</h2>

      <p>
        Ask questions about your Kubernetes cluster and the agent will
        automatically select the appropriate diagnostic tools.
      </p>

      <div className="examples">
        <div>Why did apivoicelabel restart?</div>

        <div>Check whether my cluster is healthy.</div>

        <div>Find pods with abnormal behaviour.</div>
      </div>
    </div>
  );
}

function ActivityStatus({
  status,
}: {
  status: "running" | "completed" | "failed";
}) {
  if (status === "completed") {
    return <CheckCircle2 size={18} className="status-complete" />;
  }

  if (status === "failed") {
    return <XCircle size={18} className="status-failed" />;
  }

  return <LoaderCircle size={18} className="status-running spin" />;
}

function RuntimeItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="runtime-item">
      <span>{label}</span>

      <strong>{value}</strong>
    </div>
  );
}

export default App;
