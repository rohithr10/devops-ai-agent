import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  BarChart3,
  Bot,
  Box,
  CircleDot,
  Database,
  Filter,
  Gauge,
  Layers3,
  LoaderCircle,
  RefreshCw,
  Search,
  Server,
} from "lucide-react";

const API_BASE_URL = (
  import.meta.env.VITE_API_URL || "http://localhost:8000"
).replace(/\/$/, "");

type Pod = {
  name: string;
  namespace: string;
  phase: string;
  status: string;
  ready_containers: number;
  total_containers: number;
  restart_count: number;
  node: string | null;
  pod_ip: string | null;
  start_time: string | null;
  images: string[];
};

type Deployment = {
  name: string;
  namespace: string;
  status: string;
  replicas: number;
  ready_replicas: number;
  available_replicas: number;
  updated_replicas: number;
  unavailable_replicas: number;
  images: string[];
  selector: Record<string, string>;
  created_at: string | null;
};

type Node = {
  name: string;
  status: string;
  roles: string[];
  version: string | null;
  internal_ip: string | null;
  os: string | null;
  architecture: string | null;
  container_runtime: string | null;
  unschedulable: boolean;
  created_at: string | null;
};

type KubernetesEvent = {
  id: string;
  namespace: string;
  type: string;
  reason: string;
  object_kind: string;
  object_name: string;
  message: string;
  count: number;
  first_time: string | null;
  last_time: string | null;
  source: string;
};

type Incident = KubernetesEvent & {
  severity: "critical" | "warning";
};

type Overview = {
  namespace: string;
  pods: { total: number; healthy: number; restarts: number };
  deployments: { total: number; available: number };
  nodes: { total: number; ready: number };
  incidents: { total: number; critical: number };
  recent_events: KubernetesEvent[];
};

type MetricPoint = {
  timestamp: number;
  value: number;
};

type PrometheusDashboard = {
  provider: string;
  window: string;
  generated_at: string;
  summary: {
    cpu_usage_cores: number;
    cpu_capacity_cores: number;
    cpu_usage_percent: number;
    memory_usage_bytes: number;
    memory_capacity_bytes: number;
    memory_usage_percent: number;
    targets_up: number;
    targets_total: number;
  };
  history: {
    cpu_percent: MetricPoint[];
    memory_percent: MetricPoint[];
  };
  top_pods: Array<{
    namespace: string;
    pod: string;
    cpu_millicores: number;
    memory_bytes: number;
  }>;
};

type ApiList<T> = { data: T[]; count: number };

function useApi<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setIsLoading(true);
      setError("");

      try {
        const response = await fetch(`${API_BASE_URL}${path}`, {
          signal: controller.signal,
        });
        const payload = (await response.json()) as T & { detail?: string };

        if (!response.ok) {
          throw new Error(payload.detail || "Unable to load Kubernetes data.");
        }

        setData(payload);
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === "AbortError") {
          return;
        }

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load Kubernetes data.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    load();
    return () => controller.abort();
  }, [path, refreshKey]);

  return {
    data,
    error,
    isLoading,
    refresh: () => setRefreshKey((current) => current + 1),
  };
}

function formatTime(value: string | null) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatBytes(value: number) {
  if (!value) {
    return "0 B";
  }

  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const unitIndex = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  return `${(value / 1024 ** unitIndex).toFixed(unitIndex > 1 ? 1 : 0)} ${units[unitIndex]}`;
}

function investigateUrl(prompt: string) {
  return `/agent?prompt=${encodeURIComponent(prompt)}&send=1`;
}

function statusTone(status: string) {
  const normalized = status.toLowerCase();
  if (["ready", "running", "available", "succeeded", "normal"].includes(normalized)) {
    return "healthy";
  }
  if (["progressing", "pending", "scaled down", "warning"].includes(normalized)) {
    return "pending";
  }
  return "unhealthy";
}

function PageHeader({
  eyebrow,
  title,
  detail,
  isLoading,
  onRefresh,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  isLoading: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="pods-summary">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
      <button className="secondary-button" onClick={onRefresh} disabled={isLoading}>
        <RefreshCw size={15} className={isLoading ? "spin" : ""} />
        Refresh
      </button>
    </div>
  );
}

function DataState({
  icon,
  isLoading,
  error,
  empty,
  onRetry,
  children,
}: {
  icon: ReactNode;
  isLoading: boolean;
  error: string;
  empty: boolean;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (isLoading) {
    return (
      <div className="pods-state">
        <LoaderCircle size={24} className="spin" />
        <p>Loading live Kubernetes data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="pods-state error">
        <AlertCircle size={25} />
        <strong>Could not load this page</strong>
        <p>{error}</p>
        <button className="secondary-button" onClick={onRetry}>Try again</button>
      </div>
    );
  }

  if (empty) {
    return (
      <div className="pods-state">
        {icon}
        <strong>No matching resources</strong>
        <p>Try changing the current search or filter.</p>
      </div>
    );
  }

  return children;
}

function SearchToolbar({
  search,
  setSearch,
  placeholder,
  filter,
  setFilter,
  options,
}: {
  search: string;
  setSearch: (value: string) => void;
  placeholder: string;
  filter: string;
  setFilter: (value: string) => void;
  options: string[];
}) {
  return (
    <div className="pods-toolbar">
      <label className="search-control">
        <Search size={16} />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={placeholder}
        />
      </label>
      <label className="filter-control">
        <Filter size={15} />
        <select value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">All</option>
          {options.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

function AiButton({ onClick, label = "Investigate with AI" }: { onClick: () => void; label?: string }) {
  return (
    <button className="investigate-button" onClick={onClick}>
      <Bot size={15} />
      {label}
    </button>
  );
}

export function OverviewPage() {
  const navigate = useNavigate();
  const { data, error, isLoading, refresh } = useApi<Overview>("/api/overview");

  return (
    <section className="pods-page dashboard-page">
      <PageHeader
        eyebrow="CLUSTER HEALTH"
        title="Overview"
        detail={data ? `Namespace: ${data.namespace}` : "Live Kubernetes health at a glance"}
        isLoading={isLoading}
        onRefresh={refresh}
      />
      <DataState
        icon={<Activity size={26} />}
        isLoading={isLoading}
        error={error}
        empty={!data}
        onRetry={refresh}
      >
        {data && (
          <>
            <div className="metric-grid">
              <button className="metric-card" onClick={() => navigate("/pods")}>
                <Box size={19} />
                <span>Pods</span>
                <strong>{data.pods.healthy}/{data.pods.total}</strong>
                <small>{data.pods.restarts} total restarts</small>
              </button>
              <button className="metric-card" onClick={() => navigate("/deployments")}>
                <Database size={19} />
                <span>Deployments</span>
                <strong>{data.deployments.available}/{data.deployments.total}</strong>
                <small>available</small>
              </button>
              <button className="metric-card" onClick={() => navigate("/nodes")}>
                <Server size={19} />
                <span>Nodes</span>
                <strong>{data.nodes.ready}/{data.nodes.total}</strong>
                <small>ready</small>
              </button>
              <button className="metric-card warning" onClick={() => navigate("/incidents")}>
                <AlertTriangle size={19} />
                <span>Warning events</span>
                <strong>{data.incidents.total}</strong>
                <small>{data.incidents.critical} critical</small>
              </button>
            </div>

            <div className="dashboard-grid">
              <div className="dashboard-card">
                <div className="section-heading">
                  <div>
                    <span>RECENT ACTIVITY</span>
                    <h3>Kubernetes events</h3>
                  </div>
                  <button onClick={() => navigate("/activity")}>View all</button>
                </div>
                <div className="event-list compact">
                  {data.recent_events.length === 0 ? (
                    <div className="inline-empty">No recent events.</div>
                  ) : data.recent_events.map((event) => (
                    <div className="event-row" key={event.id}>
                      <CircleDot className={event.type === "Warning" ? "event-warning" : "event-normal"} size={15} />
                      <div>
                        <strong>{event.reason}</strong>
                        <p>{event.object_kind}/{event.object_name}</p>
                      </div>
                      <time>{formatTime(event.last_time)}</time>
                    </div>
                  ))}
                </div>
              </div>

              <div className="dashboard-card copilot-card">
                <Bot size={24} />
                <h3>Need a deeper diagnosis?</h3>
                <p>Ask KubeAgent to correlate pod health, events, logs, and deployment state.</p>
                <AiButton
                  label="Investigate cluster health"
                  onClick={() => navigate(investigateUrl(
                    "Investigate the overall health of my Kubernetes cluster. Correlate unhealthy pods, restarts, warning events, deployments, and node readiness. Explain the highest-priority issues and recommend safe read-only next steps.",
                  ))}
                />
              </div>
            </div>
          </>
        )}
      </DataState>
    </section>
  );
}

function MetricChart({
  title,
  value,
  points,
  color,
}: {
  title: string;
  value: string;
  points: MetricPoint[];
  color: string;
}) {
  const coordinates = useMemo(() => {
    if (points.length < 2) {
      return "";
    }

    const values = points.map((point) => point.value);
    const maximum = Math.max(100, ...values);
    return points
      .map((point, index) => {
        const x = (index / (points.length - 1)) * 100;
        const y = 48 - (point.value / maximum) * 43;
        return `${x},${Math.max(3, y)}`;
      })
      .join(" ");
  }, [points]);

  return (
    <div className="metrics-chart-card">
      <div className="chart-heading">
        <div>
          <span>{title}</span>
          <strong>{value}</strong>
        </div>
        <BarChart3 size={18} style={{ color }} />
      </div>
      {coordinates ? (
        <svg className="metric-chart" viewBox="0 0 100 52" preserveAspectRatio="none" aria-label={`${title} history`}>
          <line x1="0" y1="48" x2="100" y2="48" />
          <line x1="0" y1="26" x2="100" y2="26" />
          <polyline points={coordinates} style={{ stroke: color }} />
        </svg>
      ) : (
        <div className="chart-empty">No time-series samples returned.</div>
      )}
    </div>
  );
}

export function MetricsPage() {
  const navigate = useNavigate();
  const [window, setWindow] = useState("1h");
  const { data, error, isLoading, refresh } = useApi<PrometheusDashboard>(
    `/api/metrics?window=${window}`,
  );

  return (
    <section className="pods-page dashboard-page">
      <PageHeader
        eyebrow="PROMETHEUS OBSERVABILITY"
        title="Metrics"
        detail={data ? `Updated ${formatTime(data.generated_at)}` : "Cluster resource telemetry"}
        isLoading={isLoading}
        onRefresh={refresh}
      />

      <div className="metrics-toolbar">
        <div className="window-picker" aria-label="Metrics time window">
          {["15m", "1h", "6h", "24h"].map((value) => (
            <button
              key={value}
              className={window === value ? "active" : ""}
              onClick={() => setWindow(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <span className="prometheus-source"><span /> Prometheus · read-only</span>
      </div>

      {isLoading ? (
        <div className="pods-state metrics-state">
          <LoaderCircle size={24} className="spin" />
          <p>Querying Prometheus...</p>
        </div>
      ) : error ? (
        <div className="pods-state error metrics-state">
          <AlertCircle size={25} />
          <strong>Prometheus is unavailable</strong>
          <p>{error}</p>
          <p className="setup-hint">Set PROMETHEUS_URL in the backend .env file, then restart the API.</p>
          <button className="secondary-button" onClick={refresh}>Try again</button>
        </div>
      ) : data ? (
        <>
          <div className="metric-grid prometheus-summary">
            <div className="metric-card static">
              <Gauge size={19} />
              <span>CPU usage</span>
              <strong>{data.summary.cpu_usage_percent.toFixed(1)}%</strong>
              <small>{data.summary.cpu_usage_cores.toFixed(2)} of {data.summary.cpu_capacity_cores.toFixed(2)} cores</small>
            </div>
            <div className="metric-card static">
              <BarChart3 size={19} />
              <span>Memory usage</span>
              <strong>{data.summary.memory_usage_percent.toFixed(1)}%</strong>
              <small>{formatBytes(data.summary.memory_usage_bytes)} of {formatBytes(data.summary.memory_capacity_bytes)}</small>
            </div>
            <div className="metric-card static">
              <CircleDot size={19} />
              <span>Scrape targets</span>
              <strong>{data.summary.targets_up}/{data.summary.targets_total}</strong>
              <small>targets currently up</small>
            </div>
            <div className="metric-card static">
              <Box size={19} />
              <span>Measured pods</span>
              <strong>{data.top_pods.length}</strong>
              <small>highest resource consumers</small>
            </div>
          </div>

          <div className="metrics-chart-grid">
            <MetricChart
              title={`CPU utilization · ${data.window}`}
              value={`${data.summary.cpu_usage_percent.toFixed(1)}%`}
              points={data.history.cpu_percent}
              color="#818cf8"
            />
            <MetricChart
              title={`Memory utilization · ${data.window}`}
              value={`${data.summary.memory_usage_percent.toFixed(1)}%`}
              points={data.history.memory_percent}
              color="#34d399"
            />
          </div>

          <div className="pods-table-card metrics-table-card">
            {data.top_pods.length === 0 ? (
              <div className="pods-state">
                <BarChart3 size={26} />
                <strong>No pod metrics found</strong>
                <p>Prometheus is connected, but container metrics were not returned.</p>
              </div>
            ) : (
              <div className="table-scroll">
                <table className="pods-table resource-table">
                  <thead><tr><th>Pod</th><th>CPU</th><th>Memory</th><th>Relative CPU</th><th aria-label="Actions" /></tr></thead>
                  <tbody>
                    {data.top_pods.map((pod) => {
                      const maximumCpu = Math.max(...data.top_pods.map((item) => item.cpu_millicores), 1);
                      return (
                        <tr key={`${pod.namespace}/${pod.pod}`}>
                          <td><div className="pod-name">{pod.pod}</div><div className="pod-meta">{pod.namespace}</div></td>
                          <td>{pod.cpu_millicores.toFixed(1)} mCPU</td>
                          <td>{formatBytes(pod.memory_bytes)}</td>
                          <td><div className="usage-bar"><span style={{ width: `${Math.max(2, pod.cpu_millicores / maximumCpu * 100)}%` }} /></div></td>
                          <td><AiButton label="Investigate" onClick={() => navigate(investigateUrl(`Investigate Kubernetes pod "${pod.pod}" in namespace "${pod.namespace}" because Prometheus reports ${pod.cpu_millicores.toFixed(1)} millicores of CPU and ${formatBytes(pod.memory_bytes)} of memory usage. Correlate metrics with pod status, restarts, events, and logs, then recommend safe read-only next steps.`))} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

export function WorkloadsPage() {
  const navigate = useNavigate();
  const { data, error, isLoading, refresh } = useApi<{
    pods: Pod[];
    deployments: Deployment[];
    count: number;
  }>("/api/workloads");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const workloads = useMemo(() => {
    const pods = (data?.pods || []).map((pod) => ({
      kind: "Pod",
      name: pod.name,
      namespace: pod.namespace,
      status: pod.status,
      ready: `${pod.ready_containers}/${pod.total_containers}`,
      detail: `${pod.restart_count} restarts`,
      images: pod.images,
    }));
    const deployments = (data?.deployments || []).map((deployment) => ({
      kind: "Deployment",
      name: deployment.name,
      namespace: deployment.namespace,
      status: deployment.status,
      ready: `${deployment.ready_replicas}/${deployment.replicas}`,
      detail: `${deployment.available_replicas} available`,
      images: deployment.images,
    }));
    const query = search.toLowerCase().trim();

    return [...deployments, ...pods].filter((item) =>
      (filter === "all" || item.kind === filter) &&
      (!query || [item.name, item.namespace, item.status, ...item.images]
        .some((value) => value.toLowerCase().includes(query))),
    );
  }, [data, filter, search]);

  return (
    <section className="pods-page dashboard-page">
      <PageHeader
        eyebrow="APPLICATION RESOURCES"
        title="Workloads"
        detail={`${data?.count || 0} pods and deployments`}
        isLoading={isLoading}
        onRefresh={refresh}
      />
      <SearchToolbar
        search={search}
        setSearch={setSearch}
        placeholder="Search workloads, namespaces, images..."
        filter={filter}
        setFilter={setFilter}
        options={["Deployment", "Pod"]}
      />
      <div className="pods-table-card">
        <DataState icon={<Layers3 size={26} />} isLoading={isLoading} error={error} empty={workloads.length === 0} onRetry={refresh}>
          <div className="table-scroll">
            <table className="pods-table resource-table">
              <thead><tr><th>Workload</th><th>Kind</th><th>Status</th><th>Ready</th><th>Details</th><th>Images</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {workloads.map((item) => (
                  <tr key={`${item.kind}/${item.namespace}/${item.name}`}>
                    <td><div className="pod-name">{item.name}</div><div className="pod-meta">{item.namespace}</div></td>
                    <td><span className="kind-badge">{item.kind}</span></td>
                    <td><span className={`status-badge ${statusTone(item.status)}`}><span />{item.status}</span></td>
                    <td><span className="ready-count">{item.ready}</span></td>
                    <td>{item.detail}</td>
                    <td><div className="image-list">{item.images.map((image) => <span key={image} title={image}>{image.split("/").pop()}</span>)}</div></td>
                    <td><AiButton onClick={() => navigate(investigateUrl(`Investigate Kubernetes ${item.kind.toLowerCase()} "${item.name}" in namespace "${item.namespace}". Check its health, events, configuration, and related pod logs. Explain any issues and recommend safe read-only next steps.`))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
      </div>
    </section>
  );
}

export function NodesPage() {
  const navigate = useNavigate();
  const { data, error, isLoading, refresh } = useApi<ApiList<Node>>("/api/nodes");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const nodes = useMemo(() => {
    const query = search.toLowerCase().trim();
    return (data?.data || []).filter((node) =>
      (filter === "all" || node.status === filter) &&
      (!query || [node.name, node.internal_ip || "", node.os || "", ...node.roles]
        .some((value) => value.toLowerCase().includes(query))),
    );
  }, [data, filter, search]);

  return (
    <section className="pods-page dashboard-page">
      <PageHeader eyebrow="CLUSTER INFRASTRUCTURE" title="Nodes" detail={`${data?.count || 0} cluster nodes`} isLoading={isLoading} onRefresh={refresh} />
      <SearchToolbar search={search} setSearch={setSearch} placeholder="Search nodes, roles, IP addresses..." filter={filter} setFilter={setFilter} options={["Ready", "NotReady"]} />
      <div className="pods-table-card">
        <DataState icon={<Server size={26} />} isLoading={isLoading} error={error} empty={nodes.length === 0} onRetry={refresh}>
          <div className="table-scroll">
            <table className="pods-table resource-table">
              <thead><tr><th>Node</th><th>Status</th><th>Roles</th><th>Version</th><th>OS / Architecture</th><th>Runtime</th><th>Created</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {nodes.map((node) => (
                  <tr key={node.name}>
                    <td><div className="pod-name">{node.name}</div><div className="pod-meta">{node.internal_ip || "No internal IP"}</div></td>
                    <td><span className={`status-badge ${statusTone(node.status)}`}><span />{node.status}</span>{node.unschedulable && <div className="pod-meta">Scheduling disabled</div>}</td>
                    <td>{node.roles.join(", ")}</td>
                    <td>{node.version || "—"}</td>
                    <td><div className="cell-primary">{node.os || "—"}</div><div className="pod-meta">{node.architecture || "—"}</div></td>
                    <td><div className="cell-primary" title={node.container_runtime || ""}>{node.container_runtime || "—"}</div></td>
                    <td className="start-time">{formatTime(node.created_at)}</td>
                    <td><AiButton onClick={() => navigate(investigateUrl(`Investigate Kubernetes node "${node.name}". Check readiness, conditions, resource pressure, events, and workloads scheduled on it. Explain any issues and recommend safe read-only next steps.`))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
      </div>
    </section>
  );
}

export function DeploymentsPage() {
  const navigate = useNavigate();
  const { data, error, isLoading, refresh } = useApi<ApiList<Deployment>>("/api/deployments");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const statuses = useMemo(() => [...new Set((data?.data || []).map((item) => item.status))].sort(), [data]);
  const deployments = useMemo(() => {
    const query = search.toLowerCase().trim();
    return (data?.data || []).filter((deployment) =>
      (filter === "all" || deployment.status === filter) &&
      (!query || [deployment.name, deployment.namespace, ...deployment.images]
        .some((value) => value.toLowerCase().includes(query))),
    );
  }, [data, filter, search]);

  return (
    <section className="pods-page dashboard-page">
      <PageHeader eyebrow="WORKLOAD CONTROLLERS" title="Deployments" detail={`${data?.count || 0} deployments`} isLoading={isLoading} onRefresh={refresh} />
      <SearchToolbar search={search} setSearch={setSearch} placeholder="Search deployments, namespaces, images..." filter={filter} setFilter={setFilter} options={statuses} />
      <div className="pods-table-card">
        <DataState icon={<Database size={26} />} isLoading={isLoading} error={error} empty={deployments.length === 0} onRetry={refresh}>
          <div className="table-scroll">
            <table className="pods-table resource-table">
              <thead><tr><th>Deployment</th><th>Status</th><th>Ready</th><th>Available</th><th>Updated</th><th>Images</th><th>Created</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {deployments.map((deployment) => (
                  <tr key={`${deployment.namespace}/${deployment.name}`}>
                    <td><div className="pod-name">{deployment.name}</div><div className="pod-meta">{deployment.namespace}</div></td>
                    <td><span className={`status-badge ${statusTone(deployment.status)}`}><span />{deployment.status}</span></td>
                    <td><span className={`ready-count${deployment.ready_replicas < deployment.replicas ? " incomplete" : ""}`}>{deployment.ready_replicas}/{deployment.replicas}</span></td>
                    <td>{deployment.available_replicas}{deployment.unavailable_replicas > 0 && <div className="pod-meta danger-text">{deployment.unavailable_replicas} unavailable</div>}</td>
                    <td>{deployment.updated_replicas}</td>
                    <td><div className="image-list">{deployment.images.map((image) => <span key={image} title={image}>{image.split("/").pop()}</span>)}</div></td>
                    <td className="start-time">{formatTime(deployment.created_at)}</td>
                    <td><AiButton onClick={() => navigate(investigateUrl(`Investigate Kubernetes deployment "${deployment.name}" in namespace "${deployment.namespace}". Check rollout status, replica health, events, related pods, and logs. Explain any issue and recommend safe read-only next steps.`))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
      </div>
    </section>
  );
}

export function IncidentsPage() {
  const navigate = useNavigate();
  const { data, error, isLoading, refresh } = useApi<ApiList<Incident>>("/api/incidents");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const incidents = useMemo(() => {
    const query = search.toLowerCase().trim();
    return (data?.data || []).filter((incident) =>
      (filter === "all" || incident.severity === filter) &&
      (!query || [incident.reason, incident.object_name, incident.message, incident.namespace]
        .some((value) => value.toLowerCase().includes(query))),
    );
  }, [data, filter, search]);

  return (
    <section className="pods-page dashboard-page">
      <PageHeader eyebrow="WARNING EVENT HISTORY" title="Incidents" detail={`${data?.count || 0} warning events retained by Kubernetes`} isLoading={isLoading} onRefresh={refresh} />
      <SearchToolbar search={search} setSearch={setSearch} placeholder="Search incidents, resources, messages..." filter={filter} setFilter={setFilter} options={["critical", "warning"]} />
      <div className="pods-table-card incident-container">
        <DataState icon={<AlertTriangle size={26} />} isLoading={isLoading} error={error} empty={incidents.length === 0} onRetry={refresh}>
          <div className="incident-list">
            {incidents.map((incident) => (
              <article className={`incident-row ${incident.severity}`} key={incident.id}>
                <div className="incident-icon"><AlertTriangle size={18} /></div>
                <div className="incident-content">
                  <div className="incident-heading">
                    <div><span className={`severity-badge ${incident.severity}`}>{incident.severity}</span><strong>{incident.reason}</strong></div>
                    <time>{formatTime(incident.last_time)}</time>
                  </div>
                  <p>{incident.message || "Kubernetes reported a warning for this resource."}</p>
                  <div className="incident-meta">{incident.object_kind}/{incident.object_name} · {incident.namespace} · occurred {incident.count} time{incident.count === 1 ? "" : "s"}</div>
                </div>
                <AiButton label="Investigate" onClick={() => navigate(investigateUrl(`Investigate Kubernetes warning event "${incident.reason}" for ${incident.object_kind} "${incident.object_name}" in namespace "${incident.namespace}". The event message is: ${incident.message}. Correlate related events, configuration, pod status, and logs to explain the cause and safe next steps.`))} />
              </article>
            ))}
          </div>
        </DataState>
      </div>
    </section>
  );
}

export function ActivityPage() {
  const navigate = useNavigate();
  const { data, error, isLoading, refresh } = useApi<ApiList<KubernetesEvent>>("/api/events");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const events = useMemo(() => {
    const query = search.toLowerCase().trim();
    return (data?.data || []).filter((event) =>
      (filter === "all" || event.type === filter) &&
      (!query || [event.reason, event.object_name, event.message, event.namespace, event.source]
        .some((value) => value.toLowerCase().includes(query))),
    );
  }, [data, filter, search]);

  return (
    <section className="pods-page dashboard-page">
      <PageHeader eyebrow="KUBERNETES EVENT STREAM" title="Activity" detail={`${data?.count || 0} retained events`} isLoading={isLoading} onRefresh={refresh} />
      <SearchToolbar search={search} setSearch={setSearch} placeholder="Search events, resources, sources..." filter={filter} setFilter={setFilter} options={["Normal", "Warning"]} />
      <div className="pods-table-card">
        <DataState icon={<Activity size={26} />} isLoading={isLoading} error={error} empty={events.length === 0} onRetry={refresh}>
          <div className="table-scroll">
            <table className="pods-table resource-table events-table">
              <thead><tr><th>Event</th><th>Type</th><th>Resource</th><th>Message</th><th>Count</th><th>Source</th><th>Last seen</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td><div className="pod-name">{event.reason}</div><div className="pod-meta">{event.namespace}</div></td>
                    <td><span className={`status-badge ${statusTone(event.type)}`}><span />{event.type}</span></td>
                    <td><div className="cell-primary">{event.object_kind}</div><div className="pod-meta">{event.object_name}</div></td>
                    <td><div className="event-message" title={event.message}>{event.message || "—"}</div></td>
                    <td>{event.count}</td>
                    <td>{event.source}</td>
                    <td className="start-time">{formatTime(event.last_time)}</td>
                    <td><AiButton label="Ask AI" onClick={() => navigate(investigateUrl(`Explain and investigate this Kubernetes ${event.type.toLowerCase()} event: reason "${event.reason}", resource ${event.object_kind} "${event.object_name}" in namespace "${event.namespace}", message: ${event.message}. Correlate it with current cluster state and recommend safe read-only next steps.`))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
      </div>
    </section>
  );
}
