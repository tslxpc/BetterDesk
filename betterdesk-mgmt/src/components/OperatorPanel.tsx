import {
  Component,
  createSignal,
  onMount,
  onCleanup,
  For,
  Show,
} from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { connectionStore } from "../stores/connection";
import { operatorStore } from "../stores/operator";
import { useNavigate } from "@solidjs/router";
import { t } from "../lib/i18n";
import TotpDialog from "./TotpDialog";

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

interface OperatorCredentials {
  access_token: string;
  requires_2fa?: boolean;
  partial_token?: string;
  user: {
    name: string;
    role: string;
  };
}

interface RemoteDevice {
  id: string;
  hostname: string;
  platform: string;
  online: boolean;
  last_online: string;
  tags: string;
  note: string;
  folder_id?: number;
  cpu?: number;
  memory?: number;
  disk?: number;
}

interface DeviceListResponse {
  success: boolean;
  devices: RemoteDevice[];
}

interface DeviceGroup {
  id: number;
  name: string;
  color: string;
  device_count: number;
}

interface HelpRequest {
  id: string;
  device_id: string;
  hostname: string;
  message: string;
  timestamp: number;
  status: string;
}

interface SessionRecord {
  id: string;
  device_id: string;
  hostname: string;
  operator: string;
  started_at: string;
  ended_at: string;
  duration_secs: number;
  action: string;
}

// ---------------------------------------------------------------------------
//  Tabs
// ---------------------------------------------------------------------------

type OperatorTab = "devices" | "help" | "modules" | "history";

// ---------------------------------------------------------------------------
//  Component
// ---------------------------------------------------------------------------

const OperatorPanel: Component = () => {
  const navigate = useNavigate();
  const existingSession = operatorStore.session();

  // Auth state
  const [loggedIn, setLoggedIn] = createSignal(!!existingSession);
  const [token, setToken] = createSignal<string | null>(existingSession?.access_token ?? null);
  const [operatorName, setOperatorName] = createSignal(existingSession?.username ?? "");
  const [operatorRole, setOperatorRole] = createSignal(existingSession?.role ?? "");

  // Login form
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [loginError, setLoginError] = createSignal<string | null>(null);
  const [loggingIn, setLoggingIn] = createSignal(false);

  // 2FA
  const [show2fa, setShow2fa] = createSignal(false);
  const [partialToken, setPartialToken] = createSignal<string | null>(null);
  const [totpError, setTotpError] = createSignal<string | null>(null);
  const [verifying2fa, setVerifying2fa] = createSignal(false);

  // Tabs
  const [activeTab, setActiveTab] = createSignal<OperatorTab>("devices");

  // Device list
  const [devices, setDevices] = createSignal<RemoteDevice[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [filter, setFilter] = createSignal<"all" | "online" | "offline">("all");

  // Groups
  const [groups, setGroups] = createSignal<DeviceGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = createSignal<number | null>(null);

  // Help requests
  const [helpRequests, setHelpRequests] = createSignal<HelpRequest[]>([]);
  const [helpLoading, setHelpLoading] = createSignal(false);

  // Selected device for context menu
  const [selectedDevice, setSelectedDevice] = createSignal<RemoteDevice | null>(null);
  const [showDeviceMenu, setShowDeviceMenu] = createSignal(false);

  // Session history
  const [sessionHistory, setSessionHistory] = createSignal<SessionRecord[]>([]);
  const [historyLoading, setHistoryLoading] = createSignal(false);

  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let helpPollInterval: ReturnType<typeof setInterval> | null = null;

  // ---- Login ----

  const handleLogin = async () => {
    const user = username().trim();
    const pass = password();
    if (!user || !pass || loggingIn()) return;

    setLoggingIn(true);
    setLoginError(null);

    try {
      const result = await invoke<OperatorCredentials>("operator_login", {
        username: user,
        password: pass,
      });

      // Check if 2FA is required
      if (result.requires_2fa && result.partial_token) {
        setPartialToken(result.partial_token);
        setShow2fa(true);
        setLoggingIn(false);
        return;
      }

      completeLogin(result);
    } catch (e: any) {
      const errMsg = e?.message || String(e);
      // Handle 2FA required from server-side error format
      if (errMsg.includes("2fa_required") || errMsg.includes("totp")) {
        try {
          const parsed = JSON.parse(errMsg);
          if (parsed.partial_token) {
            setPartialToken(parsed.partial_token);
            setShow2fa(true);
            setLoggingIn(false);
            return;
          }
        } catch (_) {}
      }
      setLoginError(errMsg);
    } finally {
      setLoggingIn(false);
    }
  };

  const handle2faSubmit = async (code: string) => {
    const pt = partialToken();
    if (!pt) return;

    setVerifying2fa(true);
    setTotpError(null);

    try {
      const result = await invoke<OperatorCredentials>("operator_login_2fa", {
        partialToken: pt,
        totpCode: code,
      });
      setShow2fa(false);
      setPartialToken(null);
      completeLogin(result);
    } catch (e: any) {
      setTotpError(e?.message || String(e));
    } finally {
      setVerifying2fa(false);
    }
  };

  const handle2faCancel = () => {
    setShow2fa(false);
    setPartialToken(null);
    setTotpError(null);
    setPassword("");
  };

  const completeLogin = (creds: OperatorCredentials) => {
    const resolvedName = creds.user.name || username();
    const resolvedRole = creds.user.role || "operator";

    setToken(creds.access_token);
    setOperatorName(resolvedName);
    setOperatorRole(resolvedRole);
    setLoggedIn(true);
    setPassword("");
    operatorStore.login(creds.access_token, resolvedName, resolvedRole);

    fetchDevices();
    fetchGroups();
    fetchHelpRequests();
    startPolling();
  };

  const handleLogout = () => {
    stopPolling();
    setLoggedIn(false);
    setToken(null);
    setOperatorName("");
    setOperatorRole("");
    setDevices([]);
    setGroups([]);
    setHelpRequests([]);
    setUsername("");
    setSelectedGroup(null);
    operatorStore.logout();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") handleLogin();
  };

  // ---- Devices ----

  const fetchDevices = async () => {
    const t = token();
    if (!t) return;

    setLoading(true);
    try {
      const result = await invoke<DeviceListResponse>("operator_get_devices", {
        accessToken: t,
      });
      setDevices(result.devices || []);
    } catch (e: any) {
      console.error("Failed to fetch devices:", e);
      if (String(e).includes("401") || String(e).includes("Unauthorized")) {
        handleLogout();
      }
    } finally {
      setLoading(false);
    }
  };

  // ---- Groups ----

  const fetchGroups = async () => {
    const t = token();
    if (!t) return;

    try {
      const result = await invoke<{ groups: DeviceGroup[] }>(
        "operator_get_device_groups",
        { accessToken: t }
      );
      const groupList = result.groups || [];
      setGroups(groupList);
      operatorStore.updateGroups(groupList);
    } catch (e) {
      console.error("Failed to fetch groups:", e);
    }
  };

  // ---- Help Requests ----

  const fetchHelpRequests = async () => {
    const t = token();
    if (!t) return;

    setHelpLoading(true);
    try {
      const result = await invoke<{ requests: HelpRequest[] }>(
        "operator_get_help_requests",
        { accessToken: t }
      );
      const requests = result.requests || [];
      setHelpRequests(requests);
      operatorStore.updateHelpRequests(requests);
    } catch (e) {
      console.error("Failed to fetch help requests:", e);
    } finally {
      setHelpLoading(false);
    }
  };

  const acceptHelpRequest = async (requestId: string, deviceId: string) => {
    const t = token();
    if (!t) return;

    try {
      await invoke("operator_accept_help_request", {
        accessToken: t,
        requestId,
      });
      await connectionStore.connect(deviceId);
      navigate("/");
    } catch (e) {
      console.error("Failed to accept help request:", e);
    }
  };

  // ---- Session History ----

  const fetchSessionHistory = async () => {
    const t = token();
    if (!t) return;

    setHistoryLoading(true);
    try {
      const result = await invoke<{ sessions: SessionRecord[] }>(
        "operator_get_session_history",
        { accessToken: t }
      );
      setSessionHistory(result.sessions || []);
    } catch (e) {
      console.error("Failed to fetch session history:", e);
      // Fallback: return empty array (endpoint may not exist yet)
      setSessionHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  // ---- Device Actions ----

  const sendDeviceAction = async (deviceId: string, action: string) => {
    closeDeviceMenu();
    const t = token();
    if (!t) return;

    try {
      await invoke("operator_send_device_action", {
        accessToken: t,
        deviceId,
        action,
      });
    } catch (e) {
      console.error(`Failed to ${action} device:`, e);
    }
  };

  const wakeOnLan = async (deviceId: string) => {
    closeDeviceMenu();
    const t = token();
    if (!t) return;

    try {
      await invoke("operator_wake_on_lan", {
        accessToken: t,
        deviceId,
      });
    } catch (e) {
      console.error("Failed to send WOL:", e);
    }
  };

  const formatDuration = (secs: number) => {
    if (secs < 60) return `${secs}s`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return `${h}h ${m}m`;
  };

  const formatHelpStatus = (status: string) => {
    const key = `operator.status_${status}`;
    const translated = t(key);
    return translated === key ? status : translated;
  };

  // ---- Polling ----

  const startPolling = () => {
    if (pollInterval) return;
    pollInterval = setInterval(() => {
      fetchDevices();
      fetchGroups();
    }, 10000);
    helpPollInterval = setInterval(fetchHelpRequests, 15000);
  };

  const stopPolling = () => {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    if (helpPollInterval) {
      clearInterval(helpPollInterval);
      helpPollInterval = null;
    }
  };

  const connectToDevice = async (deviceId: string) => {
    await connectionStore.connect(deviceId);
    navigate("/");
  };

  // ---- Device context menu ----

  const openDeviceMenu = (device: RemoteDevice, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedDevice(device);
    setShowDeviceMenu(true);
  };

  const closeDeviceMenu = () => {
    setShowDeviceMenu(false);
    setSelectedDevice(null);
  };

  const configureDevice = async (deviceId: string) => {
    closeDeviceMenu();
    try {
      await invoke("operator_configure_device", {
        accessToken: token(),
        deviceId,
      });
    } catch (e) {
      console.error("Failed to configure device:", e);
    }
  };

  const installModule = async (deviceId: string) => {
    closeDeviceMenu();
    try {
      await invoke("operator_install_module", {
        accessToken: token(),
        deviceId,
        moduleName: "betterdesk-agent",
      });
    } catch (e) {
      console.error("Failed to install module:", e);
    }
  };

  // ---- Filtered devices ----

  const filteredDevices = () => {
    let list = devices();
    const q = searchQuery().toLowerCase().trim();
    const f = filter();
    const gid = selectedGroup();

    if (q) {
      list = list.filter(
        (d) =>
          d.id.toLowerCase().includes(q) ||
          d.hostname.toLowerCase().includes(q) ||
          d.platform.toLowerCase().includes(q) ||
          (d.tags || "").toLowerCase().includes(q) ||
          (d.note || "").toLowerCase().includes(q)
      );
    }

    if (f === "online") list = list.filter((d) => d.online);
    if (f === "offline") list = list.filter((d) => !d.online);

    if (gid !== null) {
      list = list.filter((d) => d.folder_id === gid);
    }

    return list;
  };

  const onlineCount = () => devices().filter((d) => d.online).length;

  const pendingHelpCount = () =>
    helpRequests().filter((r) => r.status === "pending").length;

  onMount(async () => {
    const handleClick = () => {
      if (showDeviceMenu()) closeDeviceMenu();
    };
    document.addEventListener("click", handleClick);

    if (operatorStore.session()) {
      fetchDevices();
      fetchGroups();
      fetchHelpRequests();
      startPolling();
    }

    onCleanup(() => {
      stopPolling();
      document.removeEventListener("click", handleClick);
    });
  });

  // ---- Render ----

  return (
    <div class="operator-panel">
      {/* 2FA Dialog */}
      <Show when={show2fa()}>
        <TotpDialog
          onSubmit={handle2faSubmit}
          onCancel={handle2faCancel}
          error={totpError()}
          loading={verifying2fa()}
        />
      </Show>

      <Show when={!loggedIn()} fallback={
        /* ---- Logged In: Dashboard ---- */
        <div class="operator-dashboard">
          <div class="panel-header">
            <div>
              <h1>{t("operator.title")}</h1>
              <p class="subtitle">
                {t("operator.logged_in_as", { name: operatorName() })}
                <span class="role-badge">{operatorRole()}</span>
                &mdash; {t("operator.devices_online", { online: onlineCount(), total: devices().length })}
              </p>
            </div>
            <button class="btn-secondary" onClick={handleLogout}>
              <span class="mi mi-sm">logout</span>
              {t("operator.logout")}
            </button>
          </div>

          {/* Tab bar */}
          <div class="operator-tab-bar">
            <button
              class={`operator-tab ${activeTab() === "devices" ? "active" : ""}`}
              onClick={() => setActiveTab("devices")}
            >
              <span class="mi mi-sm">devices</span>
              Devices
              <span class="tab-count">{devices().length}</span>
            </button>
            <button
              class={`operator-tab ${activeTab() === "help" ? "active" : ""}`}
              onClick={() => setActiveTab("help")}
            >
              <span class="mi mi-sm">help</span>
              {t("operator.help_requests")}
              {pendingHelpCount() > 0 && (
                <span class="tab-badge">{pendingHelpCount()}</span>
              )}
            </button>
            <button
              class={`operator-tab ${activeTab() === "modules" ? "active" : ""}`}
              onClick={() => setActiveTab("modules")}
            >
              <span class="mi mi-sm">extension</span>
              {t("operator.modules")}
            </button>
            <button
              class={`operator-tab ${activeTab() === "history" ? "active" : ""}`}
              onClick={() => { setActiveTab("history"); fetchSessionHistory(); }}
            >
              <span class="mi mi-sm">history</span>
              {t("operator.session_history")}
            </button>
          </div>

          {/* Devices Tab */}
          <Show when={activeTab() === "devices"}>
            {/* Group chips */}
            <Show when={groups().length > 0}>
              <div class="operator-groups">
                <button
                  class={`group-chip ${selectedGroup() === null ? "active" : ""}`}
                  onClick={() => setSelectedGroup(null)}
                >
                  {t("operator.all_groups")}
                </button>
                <For each={groups()}>
                  {(group) => (
                    <button
                      class={`group-chip ${selectedGroup() === group.id ? "active" : ""}`}
                      onClick={() => setSelectedGroup(group.id)}
                      style={`--chip-color: ${group.color || "var(--primary)"}`}
                    >
                      {group.name}
                      <span class="group-chip-count">{group.device_count}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>

            {/* Toolbar */}
            <div class="operator-toolbar">
              <div class="operator-search">
                <span class="mi mi-sm">search</span>
                <input
                  type="text"
                  placeholder={t("operator.search_devices")}
                  value={searchQuery()}
                  onInput={(e) => setSearchQuery(e.currentTarget.value)}
                />
              </div>
              <div class="operator-filters">
                <button
                  class={`filter-btn ${filter() === "all" ? "active" : ""}`}
                  onClick={() => setFilter("all")}
                >
                  {t("operator.filter_all")} ({devices().length})
                </button>
                <button
                  class={`filter-btn ${filter() === "online" ? "active" : ""}`}
                  onClick={() => setFilter("online")}
                >
                  {t("operator.filter_online")} ({onlineCount()})
                </button>
                <button
                  class={`filter-btn ${filter() === "offline" ? "active" : ""}`}
                  onClick={() => setFilter("offline")}
                >
                  {t("operator.filter_offline")} ({devices().length - onlineCount()})
                </button>
              </div>
              <button class="btn-icon" onClick={fetchDevices} title={t("common.refresh")}>
                <span class={`mi ${loading() ? "spin" : ""}`}>refresh</span>
              </button>
            </div>

            {/* Device List */}
            <Show when={!loading() || devices().length > 0} fallback={
              <div class="operator-loading">
                <span class="spinner" />
                <p>{t("operator.loading_devices")}</p>
              </div>
            }>
              <Show when={filteredDevices().length > 0} fallback={
                <div class="operator-empty">
                  <span class="mi" style="font-size:48px;color:var(--text-muted)">desktop_windows</span>
                  <p>{t("operator.no_devices")}</p>
                </div>
              }>
                <div class="device-list">
                  <For each={filteredDevices()}>
                    {(device) => (
                      <div
                        class={`device-card ${device.online ? "online" : "offline"}`}
                        onContextMenu={(e) => openDeviceMenu(device, e)}
                      >
                        <div class="device-info">
                          <div class="device-status-indicator">
                            <span class={`status-dot ${device.online ? "status-dot--online" : "status-dot--offline"}`} />
                          </div>
                          <div class="device-details">
                            <div class="device-hostname">
                              {device.hostname || device.id}
                            </div>
                            <div class="device-meta">
                              <span class="device-id-label">{device.id}</span>
                              <Show when={device.platform}>
                                <span class="device-platform">{device.platform}</span>
                              </Show>
                              <Show when={device.tags}>
                                <span class="device-tags">{device.tags}</span>
                              </Show>
                            </div>
                            <Show when={device.note}>
                              <div class="device-note">{device.note}</div>
                            </Show>
                            <Show when={device.online && (device.cpu || device.memory)}>
                              <div class="device-metrics-mini">
                                <Show when={device.cpu != null}>
                                  <span class="metric-mini">
                                    CPU {Math.round(device.cpu!)}%
                                  </span>
                                </Show>
                                <Show when={device.memory != null}>
                                  <span class="metric-mini">
                                    RAM {Math.round(device.memory!)}%
                                  </span>
                                </Show>
                              </div>
                            </Show>
                          </div>
                        </div>
                        <div class="device-actions">
                          <button
                            class="btn-primary btn-sm"
                            onClick={() => connectToDevice(device.id)}
                            disabled={!device.online}
                            title={device.online ? t("operator.connect") : t("operator.device_offline")}
                          >
                            <span class="mi mi-sm">desktop_windows</span>
                            {t("operator.connect")}
                          </button>
                          <button
                            class="btn-icon btn-sm"
                            onClick={(e) => openDeviceMenu(device, e)}
                            title={t("operator.more_actions")}
                          >
                            <span class="mi mi-sm">more_vert</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </Show>

          {/* Help Requests Tab */}
          <Show when={activeTab() === "help"}>
            <div class="help-requests-inbox">
              <div class="help-inbox-header">
                <h3>{t("operator.incoming_help_requests")}</h3>
                <button class="btn-icon" onClick={fetchHelpRequests} title={t("common.refresh")}>
                  <span class={`mi ${helpLoading() ? "spin" : ""}`}>refresh</span>
                </button>
              </div>

              <Show when={helpRequests().length > 0} fallback={
                <div class="operator-empty">
                  <span class="mi" style="font-size:48px;color:var(--text-muted)">inbox</span>
                  <p>{t("operator.no_help_requests")}</p>
                  <p class="text-muted">{t("operator.help_requests_hint")}</p>
                </div>
              }>
                <div class="help-request-list">
                  <For each={helpRequests()}>
                    {(req) => (
                      <div class={`help-request-card ${req.status}`}>
                        <div class="help-request-info">
                          <div class="help-request-header-row">
                            <span class="help-request-device">
                              <span class="mi mi-sm">computer</span>
                              {req.hostname || req.device_id}
                            </span>
                            <span class={`help-request-status status--${req.status}`}>
                              {formatHelpStatus(req.status)}
                            </span>
                          </div>
                          <p class="help-request-message">{req.message}</p>
                          <span class="help-request-time">
                            {req.timestamp ? new Date(req.timestamp).toLocaleString() : "-"}
                          </span>
                        </div>
                        <div class="help-request-actions">
                          <Show when={req.status === "pending"}>
                            <button
                              class="btn-primary btn-sm"
                              onClick={() => acceptHelpRequest(req.id, req.device_id)}
                            >
                              <span class="mi mi-sm">support_agent</span>
                              {t("operator.accept_and_connect")}
                            </button>
                          </Show>
                          <button
                            class="btn-secondary btn-sm"
                            onClick={() => connectToDevice(req.device_id)}
                          >
                            <span class="mi mi-sm">desktop_windows</span>
                            {t("operator.connect")}
                          </button>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </Show>

          {/* Modules Tab */}
          <Show when={activeTab() === "modules"}>
            <div class="modules-panel">
              <div class="modules-header">
                <h3>{t("operator.operations_center")}</h3>
                <p class="text-secondary">
                  {t("operator.operations_center_hint")}
                </p>
              </div>

              <div class="module-grid">
                <div class="module-card">
                  <div class="module-icon">
                    <span class="mi" style="font-size:32px;color:var(--primary)">terminal</span>
                  </div>
                  <h4>{t("operator.device_operations")}</h4>
                  <p class="text-secondary">{t("operator.device_operations_hint")}</p>
                  <span class="module-version">{t("common.live")}</span>
                  <button
                    class="btn-secondary btn-sm module-install-btn"
                    onClick={() => setActiveTab("devices")}
                  >
                    <span class="mi mi-sm">devices</span>
                    {t("operator.open_devices")}
                  </button>
                </div>

                <div class="module-card">
                  <div class="module-icon">
                    <span class="mi" style="font-size:32px;color:var(--success)">security</span>
                  </div>
                  <h4>{t("operator.dataguard_module")}</h4>
                  <p class="text-secondary">{t("operator.dataguard_module_hint")}</p>
                  <span class="module-version">{t("common.live")}</span>
                  <button
                    class="btn-secondary btn-sm module-install-btn"
                    onClick={() => navigate("/dataguard")}
                  >
                    <span class="mi mi-sm">policy</span>
                    {t("operator.open_dataguard")}
                  </button>
                </div>

                <div class="module-card">
                  <div class="module-icon">
                    <span class="mi" style="font-size:32px;color:var(--warning)">backup</span>
                  </div>
                  <h4>{t("operator.automation_module")}</h4>
                  <p class="text-secondary">{t("operator.automation_module_hint")}</p>
                  <span class="module-version">{t("common.live")}</span>
                  <button
                    class="btn-secondary btn-sm module-install-btn"
                    onClick={() => navigate("/automation")}
                  >
                    <span class="mi mi-sm">smart_toy</span>
                    {t("operator.open_automation")}
                  </button>
                </div>

                <div class="module-card">
                  <div class="module-icon">
                    <span class="mi" style="font-size:32px;color:var(--danger)">policy</span>
                  </div>
                  <h4>{t("operator.session_timeline")}</h4>
                  <p class="text-secondary">{t("operator.session_timeline_hint")}</p>
                  <span class="module-version">{t("common.live")}</span>
                  <button
                    class="btn-secondary btn-sm module-install-btn"
                    onClick={() => {
                      setActiveTab("history");
                      fetchSessionHistory();
                    }}
                  >
                    <span class="mi mi-sm">history</span>
                    {t("operator.open_history")}
                  </button>
                </div>
              </div>
            </div>
          </Show>

          {/* Session History Tab */}
          <Show when={activeTab() === "history"}>
            <div class="session-history-panel">
              <div class="help-inbox-header">
                <h3>{t("operator.session_history")}</h3>
                <button class="btn-icon" onClick={fetchSessionHistory} title={t("common.refresh")}>
                  <span class={`mi ${historyLoading() ? "spin" : ""}`}>refresh</span>
                </button>
              </div>

              <Show when={sessionHistory().length > 0} fallback={
                <div class="operator-empty">
                  <span class="mi" style="font-size:48px;color:var(--text-muted)">history</span>
                  <p>{t("operator.no_session_history")}</p>
                  <p class="text-muted">{t("operator.session_history_hint")}</p>
                </div>
              }>
                <div class="session-history-list">
                  <div class="session-history-header">
                    <span>{t("operator.device_label")}</span>
                    <span>{t("operator.operator_label")}</span>
                    <span>{t("operator.started")}</span>
                    <span>{t("operator.duration")}</span>
                  </div>
                  <For each={sessionHistory()}>
                    {(session) => (
                      <div class="session-history-row">
                        <div class="session-device">
                          <span class="mi mi-sm">computer</span>
                          {session.hostname || session.device_id}
                        </div>
                        <div class="session-operator">{session.operator}</div>
                        <div class="session-time">
                          {new Date(session.started_at).toLocaleString()}
                        </div>
                        <div class="session-duration">
                          {formatDuration(session.duration_secs)}
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </Show>

          {/* Device context menu */}
          <Show when={showDeviceMenu() && selectedDevice()}>
            <div class="device-context-menu" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => connectToDevice(selectedDevice()!.id)}>
                <span class="mi mi-sm">desktop_windows</span>
                {t("operator.remote_connect")}
              </button>
              <button onClick={() => { invoke("open_chat_window").catch(() => {}); closeDeviceMenu(); }}>
                <span class="mi mi-sm">chat</span>
                {t("operator.send_message")}
              </button>
              <button onClick={() => { navigate("/files"); closeDeviceMenu(); }}>
                <span class="mi mi-sm">folder_copy</span>
                {t("operator.transfer_files")}
              </button>
              <div class="context-menu-divider" />
              <button onClick={() => configureDevice(selectedDevice()!.id)}>
                <span class="mi mi-sm">settings</span>
                {t("operator.configure")}
              </button>
              <button onClick={() => installModule(selectedDevice()!.id)}>
                <span class="mi mi-sm">extension</span>
                {t("operator.install_module")}
              </button>
              <button onClick={() => { navigate("/"); closeDeviceMenu(); }}>
                <span class="mi mi-sm">info</span>
                {t("operator.view_info")}
              </button>
              <div class="context-menu-divider" />
              <button onClick={() => sendDeviceAction(selectedDevice()!.id, "restart")}>
                <span class="mi mi-sm">restart_alt</span>
                {t("operator.restart_device")}
              </button>
              <button onClick={() => sendDeviceAction(selectedDevice()!.id, "shutdown")}>
                <span class="mi mi-sm">power_settings_new</span>
                {t("operator.shutdown_device")}
              </button>
              <button onClick={() => sendDeviceAction(selectedDevice()!.id, "lock")}>
                <span class="mi mi-sm">lock</span>
                {t("operator.lock_screen")}
              </button>
              <button onClick={() => sendDeviceAction(selectedDevice()!.id, "logoff")}>
                <span class="mi mi-sm">logout</span>
                {t("operator.log_off")}
              </button>
              <Show when={!selectedDevice()!.online}>
                <button onClick={() => wakeOnLan(selectedDevice()!.id)}>
                  <span class="mi mi-sm">power</span>
                  {t("operator.wake_on_lan")}
                </button>
              </Show>
            </div>
          </Show>
        </div>
      }>
        {/* Login Form */}
        <div class="operator-login">
          <div class="login-card">
            <div class="login-header">
              <span class="mi" style="font-size:40px;color:var(--primary)">support_agent</span>
              <h1>{t("operator.login")}</h1>
              <p class="subtitle">
                {t("operator.login_hint")}
              </p>
            </div>

            <div class="login-form">
              <div class="form-group">
                <label for="op-username">{t("operator.username")}</label>
                <input
                  id="op-username"
                  type="text"
                  class="form-input"
                  placeholder={t("operator.username_placeholder")}
                  value={username()}
                  onInput={(e) => setUsername(e.currentTarget.value)}
                  onKeyDown={handleKeyDown}
                  disabled={loggingIn()}
                  autocomplete="username"
                />
              </div>

              <div class="form-group">
                <label for="op-password">{t("operator.password")}</label>
                <input
                  id="op-password"
                  type="password"
                  class="form-input"
                  placeholder={t("operator.password_placeholder")}
                  value={password()}
                  onInput={(e) => setPassword(e.currentTarget.value)}
                  onKeyDown={handleKeyDown}
                  disabled={loggingIn()}
                  autocomplete="current-password"
                />
              </div>

              <Show when={loginError()}>
                <div class="login-error">
                  <span class="mi mi-sm">error</span>
                  <span>{loginError()}</span>
                </div>
              </Show>

              <button
                class="btn-primary login-btn"
                onClick={handleLogin}
                disabled={!username().trim() || !password() || loggingIn()}
              >
                <Show when={loggingIn()} fallback={t("operator.sign_in")}>
                  <span class="spinner" />
                  {t("operator.signing_in")}
                </Show>
              </button>

              <p class="login-hint">
                <span class="mi mi-sm">info</span>
                {t("operator.credentials_hint")}
              </p>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default OperatorPanel;
