import React, { FormEvent, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  Activity,
  AlertCircle,
  BarChart3,
  CirclePause,
  CirclePlay,
  Clock3,
  Database,
  ListTodo,
  LogOut,
  Menu,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Server,
  Settings,
  ShieldCheck,
  TriangleAlert,
  X
} from "lucide-react";

import "./style.css";


type Page =
  | "overview"
  | "queues"
  | "jobs"
  | "workers"
  | "dlq"
  | "settings";


type Job = {
  id: string;
  queue_id: string;
  name: string;
  status: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  available_at: string;
  claimed_by?: string;
  created_at: string;
};


type Queue = {
  id: string;
  project_id: string;
  retry_policy_id?: string;
  name: string;
  paused: boolean;
  concurrency_limit: number;
  project_name: string;
};


type Worker = {
  id: string;
  name: string;
  status: string;
  capacity: number;
  started_at: string;
  last_heartbeat_at: string;
};


type DlqEntry = {
  id: string;
  job_id: string;
  final_error: string;
  failed_at: string;
  replayed_at?: string;
};


type Execution = {
  id: string;
  job_id: string;
  worker_id?: string;
  attempt_number: number;
  status: string;
  started_at?: string;
  finished_at?: string;
  duration_ms?: number;
  error_message?: string;
};


const API = "/api/v1";


async function call(
  path: string,
  options: RequestInit = {}
) {
  const token = localStorage.getItem("jobforge_token");

  const response = await fetch(API + path, {
    ...options,

    headers: {
      "Content-Type": "application/json",

      ...(token
        ? {
            Authorization: `Bearer ${token}`
          }
        : {}),

      ...(options.headers || {})
    }
  });


  if (response.status === 401 || response.status === 403) {
    localStorage.removeItem("jobforge_token");

    if (!path.startsWith("/auth/")) {
      window.location.reload();
    }

    throw new Error("Session expired. Please sign in again.");
  }


  if (!response.ok) {
    let message = `Request failed (${response.status})`;

    try {
      const body = await response.json();

      message =
        body.message ||
        body.error ||
        message;
    } catch {
      // Response was not JSON.
    }

    throw new Error(message);
  }


  if (response.status === 204) {
    return null;
  }


  const text = await response.text();

  return text ? JSON.parse(text) : null;
}


function formatDate(value?: string) {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleString();
}


function StatusBadge({
  status
}: {
  status: string;
}) {
  return (
    <span className={`status status-${status.toLowerCase()}`}>
      {status}
    </span>
  );
}


function EmptyState({
  text
}: {
  text: string;
}) {
  return (
    <div className="empty-state">
      <Database size={28} />

      <p>{text}</p>
    </div>
  );
}


function Login({
  onLogin
}: {
  onLogin: () => void;
}) {
  const [email, setEmail] =
    useState("admin@jobforge.local");

  const [password, setPassword] =
    useState("ChangeMe123!");

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");


  async function submit(event: FormEvent) {
    event.preventDefault();

    setLoading(true);
    setError("");

    try {
      const result = await call(
        "/auth/login",
        {
          method: "POST",

          body: JSON.stringify({
            email,
            password
          })
        }
      );

      localStorage.setItem(
        "jobforge_token",
        result.token
      );

      onLogin();

    } catch (exception: any) {
      setError(
        exception.message ||
        "Unable to sign in."
      );

    } finally {
      setLoading(false);
    }
  }


  return (
    <div className="login-page">
      <div className="login-decoration" />

      <form
        className="login-card"
        onSubmit={submit}
      >
        <div className="login-logo">
          JF
        </div>

        <div>
          <h1>Welcome to JobForge</h1>

          <p>
            Sign in to manage distributed job execution.
          </p>
        </div>


        {error && (
          <div className="error-box">
            <AlertCircle size={17} />

            {error}
          </div>
        )}


        <label>
          Email address

          <input
            type="email"
            value={email}
            onChange={
              event =>
                setEmail(event.target.value)
            }
            required
          />
        </label>


        <label>
          Password

          <input
            type="password"
            value={password}
            onChange={
              event =>
                setPassword(event.target.value)
            }
            required
          />
        </label>


        <button
          className="primary full"
          disabled={loading}
        >
          {loading
            ? "Signing in..."
            : "Sign in"}
        </button>


        <div className="login-security">
          <ShieldCheck size={16} />

          JWT protected control plane
        </div>
      </form>
    </div>
  );
}


function App() {
  const [authenticated, setAuthenticated] =
    useState(
      Boolean(
        localStorage.getItem(
          "jobforge_token"
        )
      )
    );

  const [page, setPage] =
    useState<Page>("overview");

  const [jobs, setJobs] =
    useState<Job[]>([]);

  const [queues, setQueues] =
    useState<Queue[]>([]);

  const [workers, setWorkers] =
    useState<Worker[]>([]);

  const [dlq, setDlq] =
    useState<DlqEntry[]>([]);

  const [selectedJob, setSelectedJob] =
    useState<Job | null>(null);

  const [executions, setExecutions] =
    useState<Execution[]>([]);

  const [showCreateJob, setShowCreateJob] =
    useState(false);

  const [sidebarOpen, setSidebarOpen] =
    useState(false);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  const [lastRefresh, setLastRefresh] =
    useState<Date | null>(null);


  async function load() {
    if (!authenticated) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const [
        jobsData,
        queueData,
        workerData,
        dlqData
      ] = await Promise.all([
        call("/jobs"),
        call("/queues"),
        call("/workers"),
        call("/dlq")
      ]);

      setJobs(jobsData || []);
      setQueues(queueData || []);
      setWorkers(workerData || []);
      setDlq(dlqData || []);
      setLastRefresh(new Date());

    } catch (exception: any) {
      setError(exception.message);

    } finally {
      setLoading(false);
    }
  }


  useEffect(() => {
    if (!authenticated) {
      return;
    }

    load();

    const interval =
      window.setInterval(
        load,
        5000
      );

    return () =>
      window.clearInterval(interval);

  }, [authenticated]);


  async function openJob(job: Job) {
    setSelectedJob(job);

    try {
      const data =
        await call(
          `/jobs/${job.id}/executions`
        );

      setExecutions(data || []);

    } catch (exception: any) {
      setError(exception.message);
    }
  }


  function logout() {
    localStorage.removeItem(
      "jobforge_token"
    );

    setAuthenticated(false);
  }


  if (!authenticated) {
    return (
      <Login
        onLogin={() =>
          setAuthenticated(true)
        }
      />
    );
  }


  const navigation = [
    {
      id: "overview" as Page,
      label: "Overview",
      icon: BarChart3
    },
    {
      id: "queues" as Page,
      label: "Queues",
      icon: ListTodo
    },
    {
      id: "jobs" as Page,
      label: "Jobs",
      icon: Activity
    },
    {
      id: "workers" as Page,
      label: "Workers",
      icon: Server
    },
    {
      id: "dlq" as Page,
      label: "Dead Letter Queue",
      icon: TriangleAlert
    },
    {
      id: "settings" as Page,
      label: "Settings",
      icon: Settings
    }
  ];


  function navigate(nextPage: Page) {
    setPage(nextPage);
    setSidebarOpen(false);
    setSelectedJob(null);
  }


  return (
    <div className="app-shell">

      <aside
        className={
          sidebarOpen
            ? "sidebar open"
            : "sidebar"
        }
      >
        <div className="brand-row">
          <div className="brand">
            <span className="brand-mark">
              JF
            </span>

            <span>JOBFORGE</span>
          </div>

          <button
            className="icon-button mobile-only"
            onClick={() =>
              setSidebarOpen(false)
            }
          >
            <X size={20} />
          </button>
        </div>


        <div className="environment">
          <span className="online-dot" />

          Production Demo
        </div>


        <nav className="navigation">
          {navigation.map(item => {
            const Icon = item.icon;

            return (
              <button
                key={item.id}
                className={
                  page === item.id
                    ? "nav-item active"
                    : "nav-item"
                }
                onClick={() =>
                  navigate(item.id)
                }
              >
                <Icon size={18} />

                {item.label}
              </button>
            );
          })}
        </nav>


        <div className="sidebar-footer">
          <div className="user-summary">
            <div className="avatar">
              JA
            </div>

            <div>
              <strong>
                JobForge Admin
              </strong>

              <small>
                Administrator
              </small>
            </div>
          </div>

          <button
            className="logout-button"
            onClick={logout}
          >
            <LogOut size={17} />

            Sign out
          </button>
        </div>
      </aside>


      {sidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={() =>
            setSidebarOpen(false)
          }
        />
      )}


      <main className="main-content">

        <div className="topbar">
          <button
            className="icon-button mobile-only"
            onClick={() =>
              setSidebarOpen(true)
            }
          >
            <Menu size={22} />
          </button>

          <div className="topbar-status">
            <span className="online-dot" />

            Control plane operational
          </div>

          <button
            className="secondary-button"
            onClick={load}
            disabled={loading}
          >
            <RefreshCw
              size={16}
              className={
                loading ? "spin" : ""
              }
            />

            Refresh
          </button>
        </div>


        {error && (
          <div className="global-error">
            <AlertCircle size={18} />

            <span>{error}</span>

            <button
              onClick={() =>
                setError("")
              }
            >
              <X size={16} />
            </button>
          </div>
        )}


        {page === "overview" && (
          <Overview
            jobs={jobs}
            workers={workers}
            dlq={dlq}
            lastRefresh={lastRefresh}
            onNavigate={navigate}
            onOpenJob={openJob}
          />
        )}


        {page === "queues" && (
          <QueuesPage
            queues={queues}
            reload={load}
          />
        )}


        {page === "jobs" && (
          <JobsPage
            jobs={jobs}
            queues={queues}
            onCreate={() =>
              setShowCreateJob(true)
            }
            onOpenJob={openJob}
          />
        )}


        {page === "workers" && (
          <WorkersPage
            workers={workers}
          />
        )}


        {page === "dlq" && (
          <DlqPage
            entries={dlq}
            reload={load}
          />
        )}


        {page === "settings" && (
          <SettingsPage />
        )}

      </main>


      {showCreateJob && (
        <CreateJobModal
          queues={queues}
          onClose={() =>
            setShowCreateJob(false)
          }
          onCreated={async () => {
            setShowCreateJob(false);

            await load();

            setPage("jobs");
          }}
        />
      )}


      {selectedJob && (
        <JobDrawer
          job={selectedJob}
          executions={executions}
          onClose={() =>
            setSelectedJob(null)
          }
        />
      )}
    </div>
  );
}


function PageHeader({
  eyebrow,
  title,
  description,
  action
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <span className="eyebrow">
          {eyebrow}
        </span>

        <h1>{title}</h1>

        <p>{description}</p>
      </div>

      {action}
    </header>
  );
}


function Overview({
  jobs,
  workers,
  dlq,
  lastRefresh,
  onNavigate,
  onOpenJob
}: {
  jobs: Job[];
  workers: Worker[];
  dlq: DlqEntry[];
  lastRefresh: Date | null;
  onNavigate: (page: Page) => void;
  onOpenJob: (job: Job) => void;
}) {
  const cards = [
    {
      label: "Queued jobs",
      value:
        jobs.filter(
          job =>
            job.status === "QUEUED"
        ).length,
      icon: ListTodo,
      page: "jobs" as Page
    },
    {
      label: "Running jobs",
      value:
        jobs.filter(
          job =>
            job.status === "RUNNING"
        ).length,
      icon: Activity,
      page: "jobs" as Page
    },
    {
      label: "Online workers",
      value:
        workers.filter(
          worker =>
            worker.status === "ONLINE"
        ).length,
      icon: Server,
      page: "workers" as Page
    },
    {
      label: "DLQ entries",
      value: dlq.length,
      icon: TriangleAlert,
      page: "dlq" as Page
    }
  ];


  return (
    <>
      <PageHeader
        eyebrow="Control plane"
        title="Operations Overview"
        description="Live scheduler health, worker capacity and execution state."
      />


      <div className="stat-grid">
        {cards.map(card => {
          const Icon = card.icon;

          return (
            <button
              className="stat-card"
              key={card.label}
              onClick={() =>
                onNavigate(card.page)
              }
            >
              <div className="stat-icon">
                <Icon size={21} />
              </div>

              <span>{card.label}</span>

              <strong>{card.value}</strong>

              <small>
                View details →
              </small>
            </button>
          );
        })}
      </div>


      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Recent jobs</h2>

              <p>
                Latest scheduler activity
              </p>
            </div>

            <button
              className="text-button"
              onClick={() =>
                onNavigate("jobs")
              }
            >
              View all
            </button>
          </div>

          <JobTable
            jobs={jobs.slice(0, 8)}
            onOpenJob={onOpenJob}
          />
        </section>


        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Worker fleet</h2>

              <p>
                Current worker state
              </p>
            </div>
          </div>

          {workers.length === 0 ? (
            <EmptyState text="No workers registered." />
          ) : (
            <div className="worker-list">
              {workers.slice(0, 6).map(
                worker => (
                  <div
                    className="worker-row"
                    key={worker.id}
                  >
                    <div className="worker-identity">
                      <div className="server-icon">
                        <Server size={17} />
                      </div>

                      <div>
                        <strong>
                          {worker.name}
                        </strong>

                        <small>
                          Capacity {worker.capacity}
                        </small>
                      </div>
                    </div>

                    <StatusBadge
                      status={worker.status}
                    />
                  </div>
                )
              )}
            </div>
          )}
        </section>
      </div>


      <div className="refresh-note">
        <Clock3 size={14} />

        {lastRefresh
          ? `Last refreshed ${lastRefresh.toLocaleTimeString()}`
          : "Waiting for first refresh"}
      </div>
    </>
  );
}


function JobTable({
  jobs,
  onOpenJob
}: {
  jobs: Job[];
  onOpenJob: (job: Job) => void;
}) {
  if (jobs.length === 0) {
    return (
      <EmptyState text="No jobs have been submitted yet." />
    );
  }


  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Job</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Attempts</th>
            <th>Created</th>
          </tr>
        </thead>

        <tbody>
          {jobs.map(job => (
            <tr
              key={job.id}
              className="clickable-row"
              onClick={() =>
                onOpenJob(job)
              }
            >
              <td>
                <strong>{job.name}</strong>

                <small className="id-text">
                  {job.id.slice(0, 8)}
                </small>
              </td>

              <td>
                <StatusBadge
                  status={job.status}
                />
              </td>

              <td>{job.priority}</td>

              <td>
                {job.attempts}/
                {job.max_attempts}
              </td>

              <td>
                {formatDate(job.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


function JobsPage({
  jobs,
  queues,
  onCreate,
  onOpenJob
}: {
  jobs: Job[];
  queues: Queue[];
  onCreate: () => void;
  onOpenJob: (job: Job) => void;
}) {
  const [filter, setFilter] =
    useState("ALL");


  const filtered =
    filter === "ALL"
      ? jobs
      : jobs.filter(
          job => job.status === filter
        );


  return (
    <>
      <PageHeader
        eyebrow="Execution"
        title="Jobs"
        description="Submit, inspect and monitor distributed workloads."
        action={
          <button
            className="primary"
            onClick={onCreate}
            disabled={queues.length === 0}
          >
            <Plus size={17} />

            Create job
          </button>
        }
      />


      <section className="panel">
        <div className="toolbar">
          <div className="filter-tabs">
            {[
              "ALL",
              "QUEUED",
              "RUNNING",
              "COMPLETED",
              "RETRY_WAIT",
              "DEAD_LETTERED"
            ].map(status => (
              <button
                key={status}
                className={
                  filter === status
                    ? "filter active"
                    : "filter"
                }
                onClick={() =>
                  setFilter(status)
                }
              >
                {status.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>

        <JobTable
          jobs={filtered}
          onOpenJob={onOpenJob}
        />
      </section>
    </>
  );
}


function QueuesPage({
  queues,
  reload
}: {
  queues: Queue[];
  reload: () => Promise<void>;
}) {
  const [busy, setBusy] =
    useState<string | null>(null);


  async function toggle(queue: Queue) {
    setBusy(queue.id);

    try {
      await call(
        `/queues/${queue.id}/${
          queue.paused
            ? "resume"
            : "pause"
        }`,
        {
          method: "POST"
        }
      );

      await reload();

    } finally {
      setBusy(null);
    }
  }


  return (
    <>
      <PageHeader
        eyebrow="Scheduling"
        title="Queues"
        description="Control workload admission and queue concurrency."
      />


      {queues.length === 0 ? (
        <section className="panel">
          <EmptyState text="No queues configured." />
        </section>
      ) : (
        <div className="queue-grid">
          {queues.map(queue => (
            <article
              className="queue-card"
              key={queue.id}
            >
              <div className="queue-card-header">
                <div className="queue-icon">
                  <ListTodo size={21} />
                </div>

                <StatusBadge
                  status={
                    queue.paused
                      ? "PAUSED"
                      : "ACTIVE"
                  }
                />
              </div>

              <h2>{queue.name}</h2>

              <p>{queue.project_name}</p>

              <div className="queue-details">
                <div>
                  <small>
                    Concurrency limit
                  </small>

                  <strong>
                    {queue.concurrency_limit}
                  </strong>
                </div>

                <div>
                  <small>Queue ID</small>

                  <strong>
                    {queue.id.slice(0, 8)}
                  </strong>
                </div>
              </div>

              <button
                className={
                  queue.paused
                    ? "primary full"
                    : "secondary-button full"
                }
                disabled={busy === queue.id}
                onClick={() =>
                  toggle(queue)
                }
              >
                {queue.paused ? (
                  <>
                    <CirclePlay size={17} />
                    Resume queue
                  </>
                ) : (
                  <>
                    <CirclePause size={17} />
                    Pause queue
                  </>
                )}
              </button>
            </article>
          ))}
        </div>
      )}
    </>
  );
}


function WorkersPage({
  workers
}: {
  workers: Worker[];
}) {
  return (
    <>
      <PageHeader
        eyebrow="Infrastructure"
        title="Workers"
        description="Registered executors and heartbeat information."
      />


      <section className="panel">
        {workers.length === 0 ? (
          <EmptyState text="No workers registered." />
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Worker</th>
                  <th>Status</th>
                  <th>Capacity</th>
                  <th>Started</th>
                  <th>Last heartbeat</th>
                </tr>
              </thead>

              <tbody>
                {workers.map(worker => (
                  <tr key={worker.id}>
                    <td>
                      <strong>
                        {worker.name}
                      </strong>
                    </td>

                    <td>
                      <StatusBadge
                        status={worker.status}
                      />
                    </td>

                    <td>
                      {worker.capacity}
                    </td>

                    <td>
                      {formatDate(
                        worker.started_at
                      )}
                    </td>

                    <td>
                      {formatDate(
                        worker.last_heartbeat_at
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}


function DlqPage({
  entries,
  reload
}: {
  entries: DlqEntry[];
  reload: () => Promise<void>;
}) {
  const [busy, setBusy] =
    useState<string | null>(null);


  async function replay(id: string) {
    setBusy(id);

    try {
      await call(
        `/dlq/${id}/replay`,
        {
          method: "POST"
        }
      );

      await reload();

    } finally {
      setBusy(null);
    }
  }


  return (
    <>
      <PageHeader
        eyebrow="Recovery"
        title="Dead Letter Queue"
        description="Inspect exhausted jobs and replay failed workloads."
      />


      <section className="panel">
        {entries.length === 0 ? (
          <EmptyState text="Dead Letter Queue is clear." />
        ) : (
          <div className="dlq-list">
            {entries.map(entry => (
              <div
                className="dlq-entry"
                key={entry.id}
              >
                <div className="dlq-icon">
                  <TriangleAlert size={20} />
                </div>

                <div className="dlq-content">
                  <strong>
                    Job {entry.job_id.slice(0, 8)}
                  </strong>

                  <p>{entry.final_error}</p>

                  <small>
                    Failed {formatDate(entry.failed_at)}
                  </small>
                </div>

                <button
                  className="secondary-button"
                  disabled={
                    busy === entry.id ||
                    Boolean(entry.replayed_at)
                  }
                  onClick={() =>
                    replay(entry.id)
                  }
                >
                  <RotateCcw size={16} />

                  {entry.replayed_at
                    ? "Replayed"
                    : "Replay"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}


function SettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        description="Current scheduler runtime configuration."
      />


      <div className="settings-grid">
        <section className="panel">
          <h2>Worker runtime</h2>

          <div className="setting-row">
            <span>Worker capacity</span>

            <strong>8 jobs</strong>
          </div>

          <div className="setting-row">
            <span>Lease duration</span>

            <strong>30 seconds</strong>
          </div>

          <div className="setting-row">
            <span>Polling interval</span>

            <strong>500 ms</strong>
          </div>

          <div className="setting-row">
            <span>Heartbeat interval</span>

            <strong>5 seconds</strong>
          </div>
        </section>


        <section className="panel">
          <h2>Execution guarantees</h2>

          <div className="architecture-note">
            <ShieldCheck size={22} />

            <div>
              <strong>
                At-least-once execution
              </strong>

              <p>
                Job handlers should use idempotency keys
                when performing external side effects.
              </p>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}


function CreateJobModal({
  queues,
  onClose,
  onCreated
}: {
  queues: Queue[];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [queueId, setQueueId] =
    useState(
      queues[0]?.id || ""
    );

  const [name, setName] =
    useState("email.send");

  const [payload, setPayload] =
    useState(
      '{\n  "recipient": "demo@example.com"\n}'
    );

  const [priority, setPriority] =
    useState(0);

  const [maxAttempts, setMaxAttempts] =
    useState(3);

  const [idempotencyKey, setIdempotencyKey] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");


  async function submit(event: FormEvent) {
    event.preventDefault();

    setError("");
    setLoading(true);

    try {
      JSON.parse(payload);

      await call(
        "/jobs",
        {
          method: "POST",

          body: JSON.stringify({
            queueId,
            name,
            payload,
            priority,
            maxAttempts,
            idempotencyKey:
              idempotencyKey || null
          })
        }
      );

      await onCreated();

    } catch (exception: any) {
      setError(
        exception instanceof SyntaxError
          ? "Payload must contain valid JSON."
          : exception.message
      );

    } finally {
      setLoading(false);
    }
  }


  return (
    <div
      className="modal-backdrop"
      onMouseDown={onClose}
    >
      <form
        className="modal"
        onSubmit={submit}
        onMouseDown={
          event =>
            event.stopPropagation()
        }
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">
              New workload
            </span>

            <h2>Create job</h2>
          </div>

          <button
            type="button"
            className="icon-button"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>


        {error && (
          <div className="error-box">
            <AlertCircle size={17} />
            {error}
          </div>
        )}


        <div className="form-grid">
          <label className="full-field">
            Queue

            <select
              value={queueId}
              onChange={
                event =>
                  setQueueId(
                    event.target.value
                  )
              }
              required
            >
              {queues.map(queue => (
                <option
                  key={queue.id}
                  value={queue.id}
                >
                  {queue.name}
                </option>
              ))}
            </select>
          </label>


          <label className="full-field">
            Job name

            <input
              value={name}
              onChange={
                event =>
                  setName(event.target.value)
              }
              required
            />
          </label>


          <label>
            Priority

            <input
              type="number"
              value={priority}
              onChange={
                event =>
                  setPriority(
                    Number(
                      event.target.value
                    )
                  )
              }
            />
          </label>


          <label>
            Maximum attempts

            <input
              type="number"
              min="1"
              value={maxAttempts}
              onChange={
                event =>
                  setMaxAttempts(
                    Number(
                      event.target.value
                    )
                  )
              }
            />
          </label>


          <label className="full-field">
            Idempotency key

            <input
              value={idempotencyKey}
              onChange={
                event =>
                  setIdempotencyKey(
                    event.target.value
                  )
              }
              placeholder="Optional"
            />
          </label>


          <label className="full-field">
            JSON payload

            <textarea
              value={payload}
              onChange={
                event =>
                  setPayload(
                    event.target.value
                  )
              }
              rows={8}
              required
            />
          </label>
        </div>


        <div className="modal-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
          >
            Cancel
          </button>

          <button
            className="primary"
            disabled={loading}
          >
            <Play size={16} />

            {loading
              ? "Submitting..."
              : "Submit job"}
          </button>
        </div>
      </form>
    </div>
  );
}


function JobDrawer({
  job,
  executions,
  onClose
}: {
  job: Job;
  executions: Execution[];
  onClose: () => void;
}) {
  return (
    <>
      <div
        className="drawer-backdrop"
        onClick={onClose}
      />

      <aside className="job-drawer">
        <div className="drawer-header">
          <div>
            <span className="eyebrow">
              Job details
            </span>

            <h2>{job.name}</h2>
          </div>

          <button
            className="icon-button"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>


        <div className="detail-grid">
          <div>
            <small>Status</small>

            <StatusBadge
              status={job.status}
            />
          </div>

          <div>
            <small>Priority</small>

            <strong>
              {job.priority}
            </strong>
          </div>

          <div>
            <small>Attempts</small>

            <strong>
              {job.attempts}/
              {job.max_attempts}
            </strong>
          </div>

          <div>
            <small>Created</small>

            <strong>
              {formatDate(job.created_at)}
            </strong>
          </div>
        </div>


        <div className="drawer-section">
          <h3>Job ID</h3>

          <code>{job.id}</code>
        </div>


        <div className="drawer-section">
          <h3>Execution history</h3>

          {executions.length === 0 ? (
            <EmptyState text="No execution attempts recorded." />
          ) : (
            <div className="execution-list">
              {executions.map(
                execution => (
                  <div
                    className="execution-item"
                    key={execution.id}
                  >
                    <div>
                      <strong>
                        Attempt {
                          execution.attempt_number
                        }
                      </strong>

                      <small>
                        {execution.duration_ms
                          ? `${execution.duration_ms} ms`
                          : "In progress"}
                      </small>
                    </div>

                    <StatusBadge
                      status={
                        execution.status
                      }
                    />

                    {execution.error_message && (
                      <p className="execution-error">
                        {
                          execution.error_message
                        }
                      </p>
                    )}
                  </div>
                )
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}


createRoot(
  document.getElementById("root")!
).render(<App />);