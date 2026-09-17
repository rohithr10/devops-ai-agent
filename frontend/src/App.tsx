import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import ReactMarkdown from "react-markdown";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
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
  Gauge,
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

import {
  ActivityPage,
  DeploymentsPage,
  IncidentsPage,
  MetricsPage,
  NodesPage,
  OverviewPage,
  WorkloadsPage,
} from "./DashboardPages";
import PodsPage from "./PodsPage";
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

const pageMeta: Record<string, { title: string; description: string }> = {
  "/agent": {
    title: "AI DevOps Copilot",
    description: "Investigate your Kubernetes cluster using natural language",
  },
  "/overview": {
    title: "Cluster Overview",
    description: "Live health and operational signals across the cluster",
  },
  "/workloads": {
    title: "Kubernetes Workloads",
    description: "Unified health view for pods and deployments",
  },
  "/nodes": {
    title: "Kubernetes Nodes",
    description: "Inspect cluster infrastructure and readiness",
  },
  "/pods": {
    title: "Kubernetes Pods",
    description: "Monitor workload health and investigate issues with AI",
  },
  "/deployments": {
    title: "Kubernetes Deployments",
    description: "Track rollout health and replica availability",
  },
  "/incidents": {
    title: "Incident History",
    description: "Review warning events and investigate recurring failures",
  },
  "/activity": {
    title: "Cluster Activity",
    description: "Explore the Kubernetes event stream",
  },
  "/metrics": {
    title: "Prometheus Metrics",
    description: "Explore cluster resource usage and time-series telemetry",
  },
};

function generateId() {
  return `${Date.now()}-${Math.random()}`;
}

function App() {
  const socketRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const handledPromptRef = useRef("");
  const location = useLocation();
  const navigate = useNavigate();

  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting");
  const [messages, setMessages] = useState<Message[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [input, setInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [cycle, setCycle] = useState(0);

  const handleAgentEvent = useCallback((event: AgentEvent) => {
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
          { id: event.id!, tool: event.tool!, status: "running" },
        ]);
        break;

      case "tool_completed":
        setActivities((current) =>
          current.map((item) =>
            item.id === event.id ? { ...item, status: "completed" } : item,
          ),
        );
        break;

      case "tool_failed":
        setActivities((current) =>
          current.map((item) =>
            item.id === event.id ? { ...item, status: "failed" } : item,
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
  }, []);

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
        if (active) {
          setConnectionStatus("connected");
        }
      };

      socket.onmessage = (event) => {
        handleAgentEvent(JSON.parse(event.data) as AgentEvent);
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
  }, [handleAgentEvent]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activities]);

  const sendQuestion = useCallback(
    (questionValue: string) => {
      const question = questionValue.trim();

      if (
        !question ||
        isRunning ||
        connectionStatus !== "connected" ||
        socketRef.current?.readyState !== WebSocket.OPEN
      ) {
        return false;
      }

      setMessages((current) => [
        ...current,
        { id: generateId(), role: "user", content: question },
      ]);
      setActivities([]);
      setCycle(0);
      setIsRunning(true);
      socketRef.current.send(JSON.stringify({ message: question }));
      setInput("");
      return true;
    },
    [connectionStatus, isRunning],
  );

  useEffect(() => {
    if (location.pathname !== "/agent" || !location.search) {
      return;
    }

    const params = new URLSearchParams(location.search);
    const prompt = params.get("prompt")?.trim();
    if (!prompt) {
      return;
    }

    const promptKey = location.search;
    if (
      params.get("send") === "1" &&
      handledPromptRef.current !== promptKey &&
      sendQuestion(prompt)
    ) {
      handledPromptRef.current = promptKey;
      navigate("/agent", { replace: true });
      return;
    }

    const inputTimer = window.setTimeout(() => setInput(prompt), 0);
    return () => window.clearTimeout(inputTimer);
  }, [location.pathname, location.search, navigate, sendQuestion]);

  const sendMessage = () => {
    sendQuestion(input);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  const currentPage = pageMeta[location.pathname] || pageMeta["/overview"];

  return (
    <div className="app-shell">
      <Sidebar />

      <main className="main-area">
        <header className="topbar">
          <div>
            <h1>{currentPage.title}</h1>
            <p>{currentPage.description}</p>
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

        <Routes>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/workloads" element={<WorkloadsPage />} />
          <Route
            path="/agent"
            element={
              <CopilotPage
                activities={activities}
                connectionStatus={connectionStatus}
                cycle={cycle}
                handleKeyDown={handleKeyDown}
                input={input}
                isRunning={isRunning}
                messages={messages}
                messagesEndRef={messagesEndRef}
                sendMessage={sendMessage}
                setInput={setInput}
              />
            }
          />
          <Route path="/nodes" element={<NodesPage />} />
          <Route path="/pods" element={<PodsPage />} />
          <Route path="/deployments" element={<DeploymentsPage />} />
          <Route path="/metrics" element={<MetricsPage />} />
          <Route path="/incidents" element={<IncidentsPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function Sidebar() {
  const navClassName = ({ isActive }: { isActive: boolean }) =>
    `nav-item${isActive ? " active" : ""}`;

  return (
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
        <NavLink to="/agent" className={navClassName}>
          <Sparkles size={18} />
          AI Copilot
        </NavLink>
        <NavLink to="/overview" className={navClassName}>
          <Activity size={18} />
          Overview
        </NavLink>
        <NavLink to="/workloads" className={navClassName}>
          <Box size={18} />
          Workloads
        </NavLink>

        <div className="nav-label second">KUBERNETES</div>
        <NavLink to="/nodes" className={navClassName}>
          <Server size={18} />
          Nodes
        </NavLink>
        <NavLink to="/pods" className={navClassName}>
          <Box size={18} />
          Pods
        </NavLink>
        <NavLink to="/deployments" className={navClassName}>
          <Database size={18} />
          Deployments
        </NavLink>

        <div className="nav-label second">OPERATIONS</div>
        <NavLink to="/metrics" className={navClassName}>
          <Gauge size={18} />
          Metrics
        </NavLink>
        <NavLink to="/incidents" className={navClassName}>
          <AlertTriangle size={18} />
          Incidents
        </NavLink>
        <NavLink to="/activity" className={navClassName}>
          <TerminalSquare size={18} />
          Activity
        </NavLink>
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
  );
}

type CopilotPageProps = {
  activities: ActivityItem[];
  connectionStatus: ConnectionStatus;
  cycle: number;
  handleKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  input: string;
  isRunning: boolean;
  messages: Message[];
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  sendMessage: () => void;
  setInput: (value: string) => void;
};

function CopilotPage({
  activities,
  connectionStatus,
  cycle,
  handleKeyDown,
  input,
  isRunning,
  messages,
  messagesEndRef,
  sendMessage,
  setInput,
}: CopilotPageProps) {
  return (
    <div className="workspace">
      <section className="chat-panel">
        <div className="chat-scroll">
          {messages.length === 0 && <Welcome />}

          {messages.map((message) => (
            <div key={message.id} className={`message ${message.role}`}>
              <div className="avatar">
                {message.role === "user" ? <User size={17} /> : <Bot size={17} />}
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
                  Investigating cluster{cycle > 0 && ` · cycle ${cycle}`}
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
              onChange={(event) => setInput(event.target.value)}
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
              aria-label="Send message"
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
              value={connectionStatus === "connected" ? "Connected" : "Offline"}
            />
            <RuntimeItem label="Interface" value="WebSocket" />
          </div>
        </div>

        <div className="side-card safety">
          <ShieldCheck size={20} />
          <div>
            <strong>Safe investigation</strong>
            <p>
              This version can inspect your cluster but cannot restart, delete or
              modify workloads.
            </p>
          </div>
        </div>
      </aside>
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
