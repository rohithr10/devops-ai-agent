# devops-ai-agent

Read-only Kubernetes operations dashboard with an AI investigation copilot.

## Prometheus integration

The Metrics page queries the Prometheus HTTP API in read-only mode and displays:

- cluster CPU and memory utilization;
- CPU and memory history for selectable time windows;
- scrape-target availability;
- highest-consuming Kubernetes pods.

### Install Prometheus in Kubernetes

Skip this section if the cluster already has a reachable Prometheus server.

Install the Prometheus Community chart with Helm:

```bash
helm repo add prometheus-community \
  https://prometheus-community.github.io/helm-charts
helm repo update

helm upgrade --install prometheus \
  prometheus-community/prometheus \
  --namespace prometheus \
  --create-namespace
```

Check the installation:

```bash
kubectl get pods -n prometheus
kubectl get svc -n prometheus
```

The `prometheus-server` pod must show `Running` before it can accept queries.

### Troubleshoot Pending pods

If the Prometheus server or Alertmanager remains `Pending`, inspect its events
and persistent storage claims:

```bash
kubectl get pvc -n prometheus
kubectl get storageclass
kubectl describe pod -n prometheus <prometheus-server-pod>
kubectl get events -n prometheus --sort-by=.lastTimestamp
```

Messages about unbound persistent volume claims usually mean the cluster does
not have a compatible default StorageClass or PersistentVolume.

For development only, Prometheus and Alertmanager can use temporary storage:

```bash
helm upgrade prometheus prometheus-community/prometheus \
  --namespace prometheus \
  --reuse-values \
  --set server.persistentVolume.enabled=false \
  --set alertmanager.persistence.enabled=false
```

Temporary storage is deleted when a pod is replaced. Configure a suitable
StorageClass and persistent volumes for production environments.

### Connect during local development

Forward the Kubernetes service to the machine running the backend:

```bash
kubectl port-forward -n prometheus svc/prometheus-server 9090:80
```

Keep that process running. The default port-forward listens only on the local
machine and is intended for development, not as a production endpoint.

Verify readiness and execute a test query:

```bash
curl http://localhost:9090/-/ready
curl 'http://localhost:9090/api/v1/query?query=up'
```

The readiness request should report that Prometheus is ready. The query response
should contain `"status":"success"`; an `up` value of `1` means the corresponding
scrape target is reachable.

### Configure the backend

Copy `.env.example` to `.env` if needed, then choose the endpoint that is
reachable from the FastAPI process.

When FastAPI and the port-forward run on the same machine:

```env
PROMETHEUS_URL=http://localhost:9090
PROMETHEUS_BEARER_TOKEN=
PROMETHEUS_VERIFY_SSL=true
```

When FastAPI runs inside the same Kubernetes cluster:

```env
PROMETHEUS_URL=http://prometheus-server.prometheus.svc.cluster.local
PROMETHEUS_BEARER_TOKEN=
PROMETHEUS_VERIFY_SSL=true
```

When FastAPI runs elsewhere, use a private, internally reachable DNS endpoint:

```env
PROMETHEUS_URL=https://prometheus.internal.example.com
PROMETHEUS_BEARER_TOKEN=
PROMETHEUS_VERIFY_SSL=true
```

For authenticated endpoints, set `PROMETHEUS_BEARER_TOKEN`. TLS verification is
enabled by default. `PROMETHEUS_VERIFY_SSL=false` should be limited to local
development with a self-signed certificate.

Do not expose an unauthenticated Prometheus endpoint directly to the public
internet. Prefer Kubernetes service discovery, private DNS, a VPN, or an
authenticated internal proxy.

Restart FastAPI after changing `.env`, then verify the application endpoint:

```bash
curl 'http://localhost:8000/api/metrics?window=1h'
```

A successful response contains `provider`, `summary`, `history`, and `top_pods`.
The available time windows are `15m`, `1h`, `6h`, and `24h`. Open **Metrics** in
the application sidebar to view the dashboard.
