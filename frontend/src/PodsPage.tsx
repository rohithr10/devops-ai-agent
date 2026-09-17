import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  Bot,
  Box,
  Filter,
  LoaderCircle,
  RefreshCw,
  Search,
} from "lucide-react";

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

type PodsResponse = {
  data: Pod[];
  count: number;
};

const API_BASE_URL = (
  import.meta.env.VITE_API_URL || "http://localhost:8000"
).replace(/\/$/, "");

function statusClass(status: string) {
  const normalized = status.toLowerCase();

  if (normalized === "running" || normalized === "succeeded") {
    return "healthy";
  }

  if (normalized === "pending" || normalized === "terminating") {
    return "pending";
  }

  return "unhealthy";
}

function formatStartTime(value: string | null) {
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

function PodsPage() {
  const navigate = useNavigate();
  const [pods, setPods] = useState<Pod[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadPods() {
      setIsLoading(true);
      setError("");

      try {
        const response = await fetch(`${API_BASE_URL}/api/pods`, {
          signal: controller.signal,
        });
        const payload = (await response.json()) as PodsResponse & {
          detail?: string;
        };

        if (!response.ok) {
          throw new Error(payload.detail || "Unable to load pods.");
        }

        setPods(payload.data);
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === "AbortError") {
          return;
        }

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load pods.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    loadPods();
    return () => controller.abort();
  }, [refreshKey]);

  const statuses = useMemo(
    () => [...new Set(pods.map((pod) => pod.status))].sort(),
    [pods],
  );

  const filteredPods = useMemo(() => {
    const query = search.trim().toLowerCase();

    return pods.filter((pod) => {
      const matchesStatus =
        statusFilter === "all" || pod.status === statusFilter;
      const matchesSearch =
        !query ||
        [
          pod.name,
          pod.namespace,
          pod.node || "",
          pod.pod_ip || "",
          ...pod.images,
        ].some((value) => value.toLowerCase().includes(query));

      return matchesStatus && matchesSearch;
    });
  }, [pods, search, statusFilter]);

  const investigate = (pod: Pod) => {
    const prompt = [
      `Investigate Kubernetes pod "${pod.name}" in namespace "${pod.namespace}".`,
      "Check its status, restart history, recent events, current logs, and previous logs if it restarted.",
      "Explain the likely root cause and recommend safe read-only next steps.",
    ].join(" ");

    navigate(`/agent?prompt=${encodeURIComponent(prompt)}&send=1`);
  };

  return (
    <section className="pods-page">
      <div className="pods-summary">
        <div>
          <div className="eyebrow">WORKLOAD INVENTORY</div>
          <h2>Pods</h2>
          <p>
            {pods.length} total · {pods.filter((pod) => pod.status === "Running").length}{" "}
            running
          </p>
        </div>
        <button
          className="secondary-button"
          onClick={() => setRefreshKey((current) => current + 1)}
          disabled={isLoading}
        >
          <RefreshCw size={15} className={isLoading ? "spin" : ""} />
          Refresh
        </button>
      </div>

      <div className="pods-toolbar">
        <label className="search-control">
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search pods, namespaces, nodes, images..."
          />
        </label>

        <label className="filter-control">
          <Filter size={15} />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All statuses</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="pods-table-card">
        {isLoading ? (
          <div className="pods-state">
            <LoaderCircle size={24} className="spin" />
            <p>Loading pods from Kubernetes...</p>
          </div>
        ) : error ? (
          <div className="pods-state error">
            <AlertCircle size={25} />
            <strong>Could not load pods</strong>
            <p>{error}</p>
            <button
              className="secondary-button"
              onClick={() => setRefreshKey((current) => current + 1)}
            >
              Try again
            </button>
          </div>
        ) : filteredPods.length === 0 ? (
          <div className="pods-state">
            <Box size={26} />
            <strong>No pods match your filters</strong>
            <p>Try another search term or status.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="pods-table">
              <thead>
                <tr>
                  <th>Pod</th>
                  <th>Status</th>
                  <th>Ready</th>
                  <th>Restarts</th>
                  <th>Node / IP</th>
                  <th>Images</th>
                  <th>Started</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filteredPods.map((pod) => (
                  <tr key={`${pod.namespace}/${pod.name}`}>
                    <td>
                      <div className="pod-name">{pod.name}</div>
                      <div className="pod-meta">{pod.namespace}</div>
                    </td>
                    <td>
                      <span className={`status-badge ${statusClass(pod.status)}`}>
                        <span />
                        {pod.status}
                      </span>
                      {pod.phase !== pod.status && (
                        <div className="pod-meta">Phase: {pod.phase}</div>
                      )}
                    </td>
                    <td>
                      <span
                        className={
                          pod.ready_containers < pod.total_containers
                            ? "ready-count incomplete"
                            : "ready-count"
                        }
                      >
                        {pod.ready_containers}/{pod.total_containers}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`restart-count${
                          pod.restart_count >= 5
                            ? " critical"
                            : pod.restart_count > 0
                              ? " warning"
                              : ""
                        }`}
                      >
                        {pod.restart_count}
                      </span>
                    </td>
                    <td>
                      <div className="cell-primary">{pod.node || "Unscheduled"}</div>
                      <div className="pod-meta">{pod.pod_ip || "No IP"}</div>
                    </td>
                    <td>
                      <div className="image-list">
                        {pod.images.map((image) => (
                          <span key={image} title={image}>
                            {image.split("/").pop()}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="start-time">{formatStartTime(pod.start_time)}</td>
                    <td>
                      <button
                        className="investigate-button"
                        onClick={() => investigate(pod)}
                        title={`Investigate ${pod.name} with AI`}
                      >
                        <Bot size={15} />
                        Investigate with AI
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!isLoading && !error && filteredPods.length > 0 && (
        <div className="results-note">
          Showing {filteredPods.length} of {pods.length} pods · Cluster access is
          read-only
        </div>
      )}
    </section>
  );
}

export default PodsPage;
