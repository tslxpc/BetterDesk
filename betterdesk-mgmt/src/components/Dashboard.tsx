import { Component, createSignal, onMount, onCleanup, For, Show } from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../lib/i18n";
import { connectionStore } from "../stores/connection";
import { operatorStore } from "../stores/operator";

interface DeviceSummary {
  id: string;
  hostname: string;
  platform: string;
  online: boolean;
  cpu?: number;
  memory?: number;
  tags?: string;
  last_online?: string;
}

interface ServerHealth {
  status: string;
  uptime?: string;
  version?: string;
  peers_online?: number;
  peers_total?: number;
}

interface RecentSession {
  device_id: string;
  hostname: string;
  action: string;
  timestamp: string;
  duration_secs?: number;
}

const Dashboard: Component = () => {
  const navigate = useNavigate();
  const [devices, setDevices] = createSignal<DeviceSummary[]>([]);
  const [health, setHealth] = createSignal<ServerHealth>({ status: "unknown" });
  const [sessions, setSessions] = createSignal<RecentSession[]>([]);
  const [connectId, setConnectId] = createSignal("");
  const [loading, setLoading] = createSignal(true);

  const onlineDevices = () => devices().filter((d) => d.online);
  const offlineDevices = () => devices().filter((d) => !d.online);
  const avgCpu = () => {
    const online = onlineDevices().filter((d) => d.cpu != null && d.cpu > 0);
    if (online.length === 0) return 0;
    return Math.round(online.reduce((s, d) => s + (d.cpu || 0), 0) / online.length);
  };
  const avgMem = () => {
    const online = onlineDevices().filter((d) => d.memory != null && d.memory > 0);
    if (online.length === 0) return 0;
    return Math.round(online.reduce((s, d) => s + (d.memory || 0), 0) / online.length);
  };

  const refresh = async () => {
    try {
      const devs = await invoke<any[]>("operator_get_devices");
      if (Array.isArray(devs)) {
        setDevices(devs.map((d: any) => ({
          id: d.id || d.device_id || "",
          hostname: d.hostname || d.name || "",
          platform: d.platform || d.os || "",
          online: !!d.online,
          cpu: d.cpu ?? d.cpu_usage ?? 0,
          memory: d.memory ?? d.memory_usage ?? 0,
          tags: d.tags || "",
          last_online: d.last_online || "",
        })));
      }
    } catch (_) {}

    try {
      const h = await invoke<any>("server_get_health");
      if (h) setHealth({ status: h.status || "online", uptime: h.uptime, version: h.version, peers_online: h.peers_online, peers_total: h.peers_total });
    } catch (_) {}

    try {
      const s = await invoke<any[]>("operator_get_session_history");
      if (Array.isArray(s)) setSessions(s.slice(0, 8));
    } catch (_) {}

    setLoading(false);
  };

  onMount(() => {
    refresh();
    const interval = setInterval(refresh, 15000);
    onCleanup(() => clearInterval(interval));
  });

  const handleConnect = () => {
    const id = connectId().trim();
    if (id) {
      connectionStore.connect(id);
      navigate("/remote");
    }
  };

  const formatTime = (ts: string) => {
    if (!ts) return "—";
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return ts;
    }
  };

  const platformIcon = (platform: string) => {
    const p = (platform || "").toLowerCase();
    if (p.includes("windows")) return "desktop_windows";
    if (p.includes("linux")) return "terminal";
    if (p.includes("mac") || p.includes("darwin")) return "laptop_mac";
    if (p.includes("android")) return "phone_android";
    return "devices_other";
  };

  return (
    <div class="dashboard">
      {/* Top toolbar */}
      <div class="dash-toolbar">
        <div class="dash-toolbar-left">
          <h1 class="dash-title">{t("dashboard.title")}</h1>
          <Show when={health().status !== "unknown"}>
            <span class={`server-status-pill server-status-pill--${health().status === "online" || health().status === "ok" ? "online" : "offline"}`}>
              <span class="status-dot" />
              {health().version ? `v${health().version}` : t("dashboard.server_connected")}
            </span>
          </Show>
        </div>
        <div class="dash-toolbar-right">
          <div class="quick-connect">
            <input
              type="text"
              placeholder={t("dashboard.quick_connect_placeholder")}
              value={connectId()}
              onInput={(e) => setConnectId(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConnect()}
              class="quick-connect-input"
            />
            <button class="btn btn-primary btn-sm" onClick={handleConnect} disabled={!connectId().trim()}>
              <span class="mi mi-sm">play_arrow</span>
              {t("dashboard.connect")}
            </button>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div class="dash-stats">
        <div class="stat-card stat-card--primary">
          <div class="stat-icon"><span class="mi">devices</span></div>
          <div class="stat-body">
            <div class="stat-value">{devices().length}</div>
            <div class="stat-label">{t("dashboard.total_devices")}</div>
          </div>
        </div>
        <div class="stat-card stat-card--success">
          <div class="stat-icon"><span class="mi">wifi</span></div>
          <div class="stat-body">
            <div class="stat-value">{onlineDevices().length}</div>
            <div class="stat-label">{t("dashboard.online")}</div>
          </div>
        </div>
        <div class="stat-card stat-card--danger">
          <div class="stat-icon"><span class="mi">wifi_off</span></div>
          <div class="stat-body">
            <div class="stat-value">{offlineDevices().length}</div>
            <div class="stat-label">{t("dashboard.offline")}</div>
          </div>
        </div>
        <div class="stat-card stat-card--warning">
          <div class="stat-icon"><span class="mi">speed</span></div>
          <div class="stat-body">
            <div class="stat-value">{avgCpu()}%</div>
            <div class="stat-label">{t("dashboard.avg_cpu")}</div>
          </div>
        </div>
        <div class="stat-card stat-card--info">
          <div class="stat-icon"><span class="mi">memory</span></div>
          <div class="stat-body">
            <div class="stat-value">{avgMem()}%</div>
            <div class="stat-label">{t("dashboard.avg_memory")}</div>
          </div>
        </div>
      </div>

      {/* Main content grid */}
      <div class="dash-grid">
        {/* Online devices panel */}
        <div class="dash-panel dash-panel--devices">
          <div class="dash-panel-header">
            <h2><span class="mi mi-sm">devices_other</span> {t("dashboard.online_devices")}</h2>
            <A href="/operator" class="dash-panel-action">{t("dashboard.view_all")}</A>
          </div>
          <div class="dash-panel-body">
            <Show when={!loading()} fallback={<div class="dash-loading"><span class="mi spin">progress_activity</span></div>}>
              <Show when={onlineDevices().length > 0} fallback={
                <div class="dash-empty">
                  <span class="mi mi-lg">cloud_off</span>
                  <p>{t("dashboard.no_online_devices")}</p>
                </div>
              }>
                <div class="device-list">
                  <For each={onlineDevices().slice(0, 12)}>
                    {(dev) => (
                      <button
                        class="device-card"
                        onClick={() => { setConnectId(dev.id); handleConnect(); }}
                        title={`${t("dashboard.connect")}: ${dev.id}`}
                      >
                        <div class="device-card-icon">
                          <span class="mi">{platformIcon(dev.platform)}</span>
                          <span class="device-card-dot device-card-dot--online" />
                        </div>
                        <div class="device-card-info">
                          <div class="device-card-name">{dev.hostname || dev.id}</div>
                          <div class="device-card-meta">{dev.id}</div>
                        </div>
                        <div class="device-card-metrics">
                          <Show when={(dev.cpu ?? 0) > 0}>
                            <span class="device-metric" title="CPU">
                              <span class="mi mi-sm">speed</span> {Math.round(dev.cpu || 0)}%
                            </span>
                          </Show>
                          <Show when={(dev.memory ?? 0) > 0}>
                            <span class="device-metric" title="RAM">
                              <span class="mi mi-sm">memory</span> {Math.round(dev.memory || 0)}%
                            </span>
                          </Show>
                        </div>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </div>
        </div>

        {/* Quick actions */}
        <div class="dash-panel dash-panel--actions">
          <div class="dash-panel-header">
            <h2><span class="mi mi-sm">bolt</span> {t("dashboard.quick_actions")}</h2>
          </div>
          <div class="dash-panel-body">
            <div class="action-grid">
              <A href="/operator" class="action-tile">
                <span class="mi action-tile-icon">support_agent</span>
                <span>{t("sidebar.operator")}</span>
              </A>
              <A href="/discovery" class="action-tile">
                <span class="mi action-tile-icon">radar</span>
                <span>{t("sidebar.discovery")}</span>
              </A>
              <A href="/files" class="action-tile">
                <span class="mi action-tile-icon">folder_open</span>
                <span>{t("sidebar.files")}</span>
              </A>
              <A href="/dataguard" class="action-tile">
                <span class="mi action-tile-icon">security</span>
                <span>{t("sidebar.dataguard")}</span>
              </A>
              <A href="/automation" class="action-tile">
                <span class="mi action-tile-icon">smart_toy</span>
                <span>{t("sidebar.automation")}</span>
              </A>
              <A href="/inventory" class="action-tile">
                <span class="mi action-tile-icon">inventory_2</span>
                <span>{t("sidebar.devices")}</span>
              </A>
            </div>
          </div>
        </div>

        {/* Recent sessions */}
        <div class="dash-panel dash-panel--sessions">
          <div class="dash-panel-header">
            <h2><span class="mi mi-sm">history</span> {t("dashboard.recent_sessions")}</h2>
            <A href="/activity" class="dash-panel-action">{t("dashboard.view_all")}</A>
          </div>
          <div class="dash-panel-body">
            <Show when={sessions().length > 0} fallback={
              <div class="dash-empty dash-empty--sm">
                <span class="mi">event_busy</span>
                <p>{t("dashboard.no_sessions")}</p>
              </div>
            }>
              <div class="session-list">
                <For each={sessions()}>
                  {(s) => (
                    <div class="session-row">
                      <span class="mi mi-sm session-icon">screen_share</span>
                      <div class="session-info">
                        <span class="session-device">{s.hostname || s.device_id}</span>
                        <span class="session-time">{formatTime(s.timestamp)}</span>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>

        {/* Connection info */}
        <div class="dash-panel dash-panel--connection">
          <div class="dash-panel-header">
            <h2><span class="mi mi-sm">info</span> {t("dashboard.my_device")}</h2>
          </div>
          <div class="dash-panel-body">
            <div class="connection-info">
              <div class="connection-id-display">
                <div class="connection-id-label">{t("connection.device_id")}</div>
                <div class="connection-id-value">
                  <span>{connectionStore.deviceId() || "—"}</span>
                  <button
                    class="btn-icon"
                    onClick={() => navigator.clipboard.writeText(connectionStore.deviceId())}
                    title={t("common.copy")}
                  >
                    <span class="mi mi-sm">content_copy</span>
                  </button>
                </div>
              </div>
              <div class="connection-status-row">
                <span class={`status-dot ${connectionStore.regStatus()?.registered ? "status-dot--online" : "status-dot--offline"}`} />
                <span class="connection-server">
                  {connectionStore.regStatus()?.server_address || t("dashboard.not_connected")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
