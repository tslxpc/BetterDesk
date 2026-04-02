import {
  Component,
  createSignal,
  createEffect,
  onMount,
  onCleanup,
  Show,
  For,
} from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../lib/i18n";

interface CdapConfig {
  gateway_url: string;
  auth_method: string;
  api_key: string;
  device_token: string;
  username: string;
  password: string;
  device_id: string;
  device_name: string;
  file_root: string;
  enable_terminal: boolean;
  enable_file_browser: boolean;
  enable_clipboard: boolean;
  enable_remote_desktop: boolean;
  enable_sysmanage: boolean;
  enable_automation: boolean;
  heartbeat_interval_secs: number;
  auto_connect: boolean;
}

interface CdapStatus {
  connected: boolean;
  device_id: string;
  gateway_url: string;
  uptime_secs: number;
  heartbeat_count: number;
  active_sessions: string[];
  last_error: string | null;
}

const defaultConfig: CdapConfig = {
  gateway_url: "",
  auth_method: "api_key",
  api_key: "",
  device_token: "",
  username: "",
  password: "",
  device_id: "",
  device_name: "",
  file_root: "C:\\",
  enable_terminal: true,
  enable_file_browser: true,
  enable_clipboard: true,
  enable_remote_desktop: true,
  enable_sysmanage: true,
  enable_automation: true,
  heartbeat_interval_secs: 15,
  auto_connect: false,
};

const formatUptime = (secs: number): string => {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const CdapPanel: Component = () => {
  const [config, setConfig] = createSignal<CdapConfig>(defaultConfig);
  const [status, setStatus] = createSignal<CdapStatus | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [connecting, setConnecting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [showAdvanced, setShowAdvanced] = createSignal(false);
  const [editMode, setEditMode] = createSignal(false);

  let pollInterval: number | undefined;

  onMount(async () => {
    await loadConfig();
    await pollStatus();

    // Poll status every 5 seconds
    pollInterval = window.setInterval(pollStatus, 5000);
  });

  onCleanup(() => {
    if (pollInterval) clearInterval(pollInterval);
  });

  const loadConfig = async () => {
    try {
      const cfg = await invoke<CdapConfig>("cdap_get_config");
      setConfig(cfg);
    } catch (e) {
      console.error("Failed to load CDAP config:", e);
    }
  };

  const pollStatus = async () => {
    try {
      const s = await invoke<CdapStatus>("cdap_status");
      setStatus(s);
    } catch (e) {
      console.error("Failed to get CDAP status:", e);
    }
  };

  const saveConfig = async () => {
    setSaving(true);
    setError(null);
    try {
      await invoke("cdap_save_config", { config: config() });
      setEditMode(false);
    } catch (e: any) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const connect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const s = await invoke<CdapStatus>("cdap_connect");
      setStatus(s);
    } catch (e: any) {
      setError(String(e));
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    try {
      await invoke("cdap_disconnect");
      await pollStatus();
    } catch (e: any) {
      setError(String(e));
    }
  };

  const updateField = (field: keyof CdapConfig, value: any) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  const isConnected = () => status()?.connected ?? false;

  return (
    <div class="cdap-panel">
      <div class="page-header">
        <div class="page-title">
          <span class="mi mi-lg">widgets</span>
          <h1>CDAP Agent</h1>
        </div>
        <p class="page-subtitle">
          Device management, telemetry, and remote control via CDAP protocol
        </p>
      </div>

      {/* Status Card */}
      <div class={`status-card ${isConnected() ? "connected" : "disconnected"}`}>
        <div class="status-header">
          <div class="status-indicator">
            <div class={`status-dot ${isConnected() ? "online" : "offline"}`} />
            <span class="status-label">
              {isConnected() ? "Connected" : "Disconnected"}
            </span>
          </div>
          <div class="status-actions">
            <Show when={!isConnected()}>
              <button
                class="btn btn-primary"
                disabled={connecting() || !config().gateway_url}
                onClick={connect}
              >
                {connecting() ? "Connecting..." : "Connect"}
              </button>
            </Show>
            <Show when={isConnected()}>
              <button class="btn btn-danger" onClick={disconnect}>
                Disconnect
              </button>
            </Show>
          </div>
        </div>

        <Show when={status()}>
          {(s) => (
            <div class="status-details">
              <div class="status-row">
                <span class="status-key">Device ID</span>
                <span class="status-value mono">{s().device_id || "—"}</span>
              </div>
              <div class="status-row">
                <span class="status-key">Gateway</span>
                <span class="status-value mono">{s().gateway_url || "—"}</span>
              </div>
              <Show when={isConnected()}>
                <div class="status-row">
                  <span class="status-key">Uptime</span>
                  <span class="status-value">{formatUptime(s().uptime_secs)}</span>
                </div>
                <div class="status-row">
                  <span class="status-key">Heartbeats</span>
                  <span class="status-value">{s().heartbeat_count}</span>
                </div>
                <Show when={s().active_sessions.length > 0}>
                  <div class="status-row">
                    <span class="status-key">Active Sessions</span>
                    <span class="status-value">
                      {s().active_sessions.join(", ")}
                    </span>
                  </div>
                </Show>
              </Show>
              <Show when={s().last_error}>
                <div class="status-row error">
                  <span class="status-key">Error</span>
                  <span class="status-value">{s().last_error}</span>
                </div>
              </Show>
            </div>
          )}
        </Show>
      </div>

      {/* Error Banner */}
      <Show when={error()}>
        <div class="error-banner">
          <span>{error()}</span>
          <button class="btn-icon" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      </Show>

      {/* Configuration */}
      <div class="section">
        <div class="section-header">
          <h2>Configuration</h2>
          <Show when={!editMode()}>
            <button class="btn btn-outline" onClick={() => setEditMode(true)}>
              Edit
            </button>
          </Show>
          <Show when={editMode()}>
            <div class="header-actions">
              <button class="btn btn-outline" onClick={() => { setEditMode(false); loadConfig(); }}>
                Cancel
              </button>
              <button class="btn btn-primary" disabled={saving()} onClick={saveConfig}>
                {saving() ? "Saving..." : "Save"}
              </button>
            </div>
          </Show>
        </div>

        <div class="form-grid">
          <div class="form-group full">
            <label>Gateway URL</label>
            <input
              type="text"
              placeholder="ws://192.168.0.110:21122/cdap"
              value={config().gateway_url}
              disabled={!editMode()}
              onInput={(e) => updateField("gateway_url", e.currentTarget.value)}
            />
          </div>

          <div class="form-group">
            <label>Auth Method</label>
            <select
              value={config().auth_method}
              disabled={!editMode()}
              onChange={(e) => updateField("auth_method", e.currentTarget.value)}
            >
              <option value="api_key">API Key</option>
              <option value="device_token">Device Token</option>
              <option value="user_password">User / Password</option>
            </select>
          </div>

          <Show when={config().auth_method === "api_key"}>
            <div class="form-group">
              <label>API Key</label>
              <input
                type="password"
                placeholder="Enter API key"
                value={config().api_key}
                disabled={!editMode()}
                onInput={(e) => updateField("api_key", e.currentTarget.value)}
              />
            </div>
          </Show>

          <Show when={config().auth_method === "device_token"}>
            <div class="form-group">
              <label>Device Token</label>
              <input
                type="password"
                placeholder="Enter device token"
                value={config().device_token}
                disabled={!editMode()}
                onInput={(e) => updateField("device_token", e.currentTarget.value)}
              />
            </div>
          </Show>

          <Show when={config().auth_method === "user_password"}>
            <div class="form-group">
              <label>Username</label>
              <input
                type="text"
                placeholder="Username"
                value={config().username}
                disabled={!editMode()}
                onInput={(e) => updateField("username", e.currentTarget.value)}
              />
            </div>
            <div class="form-group">
              <label>Password</label>
              <input
                type="password"
                placeholder="Password"
                value={config().password}
                disabled={!editMode()}
                onInput={(e) => updateField("password", e.currentTarget.value)}
              />
            </div>
          </Show>

          <div class="form-group">
            <label>Device Name</label>
            <input
              type="text"
              placeholder="My PC"
              value={config().device_name}
              disabled={!editMode()}
              onInput={(e) => updateField("device_name", e.currentTarget.value)}
            />
          </div>

          <div class="form-group">
            <label>Device ID</label>
            <input
              type="text"
              placeholder="Auto-generated"
              value={config().device_id}
              disabled={!editMode()}
              onInput={(e) => updateField("device_id", e.currentTarget.value)}
            />
            <span class="hint">Leave empty for auto-generation</span>
          </div>
        </div>

        {/* Advanced Settings */}
        <button
          class="btn-link"
          onClick={() => setShowAdvanced(!showAdvanced())}
        >
          {showAdvanced() ? "▾ Hide Advanced" : "▸ Advanced Settings"}
        </button>

        <Show when={showAdvanced()}>
          <div class="advanced-section">
            <div class="form-grid">
              <div class="form-group">
                <label>File Root</label>
                <input
                  type="text"
                  value={config().file_root}
                  disabled={!editMode()}
                  onInput={(e) => updateField("file_root", e.currentTarget.value)}
                />
              </div>

              <div class="form-group">
                <label>Heartbeat Interval (s)</label>
                <input
                  type="number"
                  min="5"
                  max="300"
                  value={config().heartbeat_interval_secs}
                  disabled={!editMode()}
                  onInput={(e) =>
                    updateField("heartbeat_interval_secs", parseInt(e.currentTarget.value) || 15)
                  }
                />
              </div>
            </div>

            <h3 class="toggle-heading">Capabilities</h3>
            <div class="toggle-grid">
              <ToggleItem
                label="Terminal Access"
                checked={config().enable_terminal}
                disabled={!editMode()}
                onChange={(v) => updateField("enable_terminal", v)}
              />
              <ToggleItem
                label="File Browser"
                checked={config().enable_file_browser}
                disabled={!editMode()}
                onChange={(v) => updateField("enable_file_browser", v)}
              />
              <ToggleItem
                label="Clipboard Sync"
                checked={config().enable_clipboard}
                disabled={!editMode()}
                onChange={(v) => updateField("enable_clipboard", v)}
              />
              <ToggleItem
                label="Remote Desktop"
                checked={config().enable_remote_desktop}
                disabled={!editMode()}
                onChange={(v) => updateField("enable_remote_desktop", v)}
              />
              <ToggleItem
                label="System Management"
                checked={config().enable_sysmanage}
                disabled={!editMode()}
                onChange={(v) => updateField("enable_sysmanage", v)}
              />
              <ToggleItem
                label="Automation"
                checked={config().enable_automation}
                disabled={!editMode()}
                onChange={(v) => updateField("enable_automation", v)}
              />
              <ToggleItem
                label="Auto-connect on Startup"
                checked={config().auto_connect}
                disabled={!editMode()}
                onChange={(v) => updateField("auto_connect", v)}
              />
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
};

// Toggle item sub-component
const ToggleItem: Component<{
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}> = (props) => {
  return (
    <label class={`toggle-item ${props.disabled ? "disabled" : ""}`}>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
      />
      <span class="toggle-switch" />
      <span class="toggle-label">{props.label}</span>
    </label>
  );
};

export default CdapPanel;
