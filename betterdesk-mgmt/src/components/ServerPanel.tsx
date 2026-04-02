import {
  Component,
  createSignal,
  onMount,
  onCleanup,
  For,
  Show,
} from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { operatorStore } from "../stores/operator";
import { t } from "../lib/i18n";

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

interface ServerHealth {
  status: string;
  uptime_seconds: number;
  go_version: string;
  peer_count: number;
  online_count: number;
  relay_sessions: number;
  memory_mb: number;
  goroutines: number;
}

interface ConnectedClient {
  id: string;
  hostname: string;
  platform: string;
  ip: string;
  connected_at: string;
  protocol: string;
}

interface OperatorUser {
  id: number;
  username: string;
  role: string;
  totp_enabled: boolean;
  last_login: string;
  created_at: string;
}

interface AuditEvent {
  id: number;
  action: string;
  actor: string;
  details: string;
  ip: string;
  created_at: string;
}

interface ApiKeyEntry {
  id: number;
  name: string;
  prefix: string;
  role: string;
  created_at: string;
  last_used: string;
}

// ---------------------------------------------------------------------------
//  Tabs
// ---------------------------------------------------------------------------

type ServerTab = "overview" | "clients" | "operators" | "audit" | "keys" | "config";

// ---------------------------------------------------------------------------
//  Component
// ---------------------------------------------------------------------------

const ServerPanel: Component = () => {
  const [activeTab, setActiveTab] = createSignal<ServerTab>("overview");
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  // Overview
  const [health, setHealth] = createSignal<ServerHealth | null>(null);

  // Clients
  const [clients, setClients] = createSignal<ConnectedClient[]>([]);
  const [clientSearch, setClientSearch] = createSignal("");

  // Operators
  const [operators, setOperators] = createSignal<OperatorUser[]>([]);

  // Audit log
  const [auditEvents, setAuditEvents] = createSignal<AuditEvent[]>([]);
  const [auditFilter, setAuditFilter] = createSignal("all");

  // API keys
  const [apiKeys, setApiKeys] = createSignal<ApiKeyEntry[]>([]);

  let refreshInterval: number | undefined;

  // -------------------------------------------------------------------------
  //  Data fetching
  // -------------------------------------------------------------------------

  const fetchHealth = async () => {
    try {
      const data = await invoke<ServerHealth>("server_get_health");
      setHealth(data);
      setError(null);
    } catch (e: any) {
      setError(e?.toString() ?? t("server.fetch_error"));
    }
  };

  const fetchClients = async () => {
    try {
      const data = await invoke<ConnectedClient[]>("server_get_clients");
      setClients(data);
    } catch (_) {}
  };

  const fetchOperators = async () => {
    try {
      const data = await invoke<OperatorUser[]>("server_get_operators");
      setOperators(data);
    } catch (_) {}
  };

  const fetchAudit = async () => {
    try {
      const data = await invoke<AuditEvent[]>("server_get_audit", {
        filter: auditFilter(),
      });
      setAuditEvents(data);
    } catch (_) {}
  };

  const fetchApiKeys = async () => {
    try {
      const data = await invoke<ApiKeyEntry[]>("server_get_api_keys");
      setApiKeys(data);
    } catch (_) {}
  };

  const refreshTab = async () => {
    setLoading(true);
    switch (activeTab()) {
      case "overview":
        await fetchHealth();
        break;
      case "clients":
        await fetchClients();
        break;
      case "operators":
        await fetchOperators();
        break;
      case "audit":
        await fetchAudit();
        break;
      case "keys":
        await fetchApiKeys();
        break;
    }
    setLoading(false);
  };

  onMount(async () => {
    await refreshTab();
    refreshInterval = window.setInterval(refreshTab, 15000);
  });

  onCleanup(() => {
    if (refreshInterval) clearInterval(refreshInterval);
  });

  // -------------------------------------------------------------------------
  //  Helpers
  // -------------------------------------------------------------------------

  const formatUptime = (secs: number): string => {
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  const filteredClients = () => {
    const q = clientSearch().toLowerCase();
    if (!q) return clients();
    return clients().filter(
      (c) =>
        c.id.toLowerCase().includes(q) ||
        c.hostname.toLowerCase().includes(q) ||
        c.ip.includes(q)
    );
  };

  const switchTab = async (tab: ServerTab) => {
    setActiveTab(tab);
    await refreshTab();
  };

  const handleDisconnectClient = async (id: string) => {
    try {
      await invoke("server_disconnect_client", { peerId: id });
      await fetchClients();
    } catch (_) {}
  };

  const handleBanClient = async (id: string) => {
    if (!confirm(t("server.confirm_ban"))) return;
    try {
      await invoke("server_ban_client", { peerId: id });
      await fetchClients();
    } catch (_) {}
  };

  const handleRevokeKey = async (id: number) => {
    if (!confirm(t("server.confirm_revoke_key"))) return;
    try {
      await invoke("server_revoke_api_key", { keyId: id });
      await fetchApiKeys();
    } catch (_) {}
  };

  // -------------------------------------------------------------------------
  //  Render
  // -------------------------------------------------------------------------

  return (
    <div class="panel server-panel">
      <div class="panel-header">
        <h2>
          <span class="mi">dns</span>
          {t("server.title")}
        </h2>
        <Show when={!operatorStore.isLoggedIn}>
          <div class="panel-notice">
            <span class="mi">warning</span>
            {t("server.login_required")}
          </div>
        </Show>
      </div>

      <div class="tab-bar">
        <For each={["overview", "clients", "operators", "audit", "keys", "config"] as ServerTab[]}>
          {(tab) => (
            <button
              class={`tab-btn ${activeTab() === tab ? "active" : ""}`}
              onClick={() => switchTab(tab)}
            >
              <span class="mi">
                {tab === "overview" ? "dashboard" :
                 tab === "clients" ? "devices" :
                 tab === "operators" ? "people" :
                 tab === "audit" ? "history" :
                 tab === "keys" ? "vpn_key" : "tune"}
              </span>
              {t(`server.tab_${tab}`)}
            </button>
          )}
        </For>
      </div>

      <Show when={error()}>
        <div class="panel-error">
          <span class="mi">error</span>
          {error()}
        </div>
      </Show>

      <div class="panel-body">
        {/* ====== OVERVIEW ====== */}
        <Show when={activeTab() === "overview"}>
          <Show when={health()} fallback={<div class="loading-state">{t("common.loading")}</div>}>
            {(h) => (
              <div class="stats-grid">
                <div class="stat-card stat-card--primary">
                  <span class="mi stat-icon">check_circle</span>
                  <div class="stat-value">{h().status}</div>
                  <div class="stat-label">{t("server.status")}</div>
                </div>
                <div class="stat-card">
                  <span class="mi stat-icon">schedule</span>
                  <div class="stat-value">{formatUptime(h().uptime_seconds)}</div>
                  <div class="stat-label">{t("server.uptime")}</div>
                </div>
                <div class="stat-card">
                  <span class="mi stat-icon">devices</span>
                  <div class="stat-value">{h().online_count} / {h().peer_count}</div>
                  <div class="stat-label">{t("server.peers_online")}</div>
                </div>
                <div class="stat-card">
                  <span class="mi stat-icon">swap_horiz</span>
                  <div class="stat-value">{h().relay_sessions}</div>
                  <div class="stat-label">{t("server.relay_sessions")}</div>
                </div>
                <div class="stat-card">
                  <span class="mi stat-icon">memory</span>
                  <div class="stat-value">{h().memory_mb.toFixed(1)} MB</div>
                  <div class="stat-label">{t("server.memory")}</div>
                </div>
                <div class="stat-card">
                  <span class="mi stat-icon">hub</span>
                  <div class="stat-value">{h().goroutines}</div>
                  <div class="stat-label">{t("server.goroutines")}</div>
                </div>
              </div>
            )}
          </Show>
        </Show>

        {/* ====== CONNECTED CLIENTS ====== */}
        <Show when={activeTab() === "clients"}>
          <div class="toolbar">
            <input
              type="text"
              class="search-input"
              placeholder={t("server.search_clients")}
              value={clientSearch()}
              onInput={(e) => setClientSearch(e.currentTarget.value)}
            />
            <span class="toolbar-count">{filteredClients().length} {t("server.connected")}</span>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>{t("server.col_id")}</th>
                  <th>{t("server.col_hostname")}</th>
                  <th>{t("server.col_platform")}</th>
                  <th>{t("server.col_ip")}</th>
                  <th>{t("server.col_protocol")}</th>
                  <th>{t("server.col_connected")}</th>
                  <th>{t("server.col_actions")}</th>
                </tr>
              </thead>
              <tbody>
                <For each={filteredClients()}>
                  {(client) => (
                    <tr>
                      <td class="monospace">{client.id}</td>
                      <td>{client.hostname}</td>
                      <td>{client.platform}</td>
                      <td class="monospace">{client.ip}</td>
                      <td>{client.protocol}</td>
                      <td>{new Date(client.connected_at).toLocaleString()}</td>
                      <td class="actions-cell">
                        <button class="btn btn-sm btn-ghost" onClick={() => handleDisconnectClient(client.id)} title={t("server.disconnect")}>
                          <span class="mi">link_off</span>
                        </button>
                        <button class="btn btn-sm btn-ghost btn-danger" onClick={() => handleBanClient(client.id)} title={t("server.ban")}>
                          <span class="mi">block</span>
                        </button>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>

        {/* ====== OPERATORS ====== */}
        <Show when={activeTab() === "operators"}>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>{t("server.col_username")}</th>
                  <th>{t("server.col_role")}</th>
                  <th>{t("server.col_2fa")}</th>
                  <th>{t("server.col_last_login")}</th>
                  <th>{t("server.col_created")}</th>
                </tr>
              </thead>
              <tbody>
                <For each={operators()}>
                  {(op) => (
                    <tr>
                      <td>{op.username}</td>
                      <td>
                        <span class={`role-badge role-badge--${op.role}`}>{op.role}</span>
                      </td>
                      <td>
                        <span class={`mi ${op.totp_enabled ? "text-success" : "text-muted"}`}>
                          {op.totp_enabled ? "verified_user" : "no_encryption"}
                        </span>
                      </td>
                      <td>{op.last_login ? new Date(op.last_login).toLocaleString() : "—"}</td>
                      <td>{new Date(op.created_at).toLocaleString()}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>

        {/* ====== AUDIT LOG ====== */}
        <Show when={activeTab() === "audit"}>
          <div class="toolbar">
            <select
              class="filter-select"
              value={auditFilter()}
              onChange={(e) => {
                setAuditFilter(e.currentTarget.value);
                fetchAudit();
              }}
            >
              <option value="all">{t("server.filter_all")}</option>
              <option value="auth">{t("server.filter_auth")}</option>
              <option value="admin">{t("server.filter_admin")}</option>
              <option value="security">{t("server.filter_security")}</option>
            </select>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>{t("server.col_time")}</th>
                  <th>{t("server.col_action")}</th>
                  <th>{t("server.col_actor")}</th>
                  <th>{t("server.col_details")}</th>
                  <th>{t("server.col_ip")}</th>
                </tr>
              </thead>
              <tbody>
                <For each={auditEvents()}>
                  {(ev) => (
                    <tr>
                      <td>{new Date(ev.created_at).toLocaleString()}</td>
                      <td>
                        <span class={`action-badge action-badge--${ev.action.includes("fail") || ev.action.includes("ban") ? "danger" : "info"}`}>
                          {ev.action}
                        </span>
                      </td>
                      <td>{ev.actor}</td>
                      <td class="detail-cell">{ev.details}</td>
                      <td class="monospace">{ev.ip}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>

        {/* ====== API KEYS ====== */}
        <Show when={activeTab() === "keys"}>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>{t("server.col_name")}</th>
                  <th>{t("server.col_prefix")}</th>
                  <th>{t("server.col_role")}</th>
                  <th>{t("server.col_created")}</th>
                  <th>{t("server.col_last_used")}</th>
                  <th>{t("server.col_actions")}</th>
                </tr>
              </thead>
              <tbody>
                <For each={apiKeys()}>
                  {(key) => (
                    <tr>
                      <td>{key.name}</td>
                      <td class="monospace">{key.prefix}…</td>
                      <td>
                        <span class={`role-badge role-badge--${key.role}`}>{key.role}</span>
                      </td>
                      <td>{new Date(key.created_at).toLocaleString()}</td>
                      <td>{key.last_used ? new Date(key.last_used).toLocaleString() : "—"}</td>
                      <td>
                        <button class="btn btn-sm btn-ghost btn-danger" onClick={() => handleRevokeKey(key.id)} title={t("server.revoke")}>
                          <span class="mi">delete</span>
                        </button>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>

        {/* ====== CONFIG ====== */}
        <Show when={activeTab() === "config"}>
          <div class="config-info">
            <p class="text-muted">
              <span class="mi">info</span>
              {t("server.config_hint")}
            </p>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default ServerPanel;
