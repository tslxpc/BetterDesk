import {
  Component,
  createSignal,
  createEffect,
  onMount,
  Show,
  For,
} from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../lib/i18n";

interface DeviceInfo {
  hostname: string;
  current_user: string;
  os: string;
  uptime_secs: number;
  cpu_usage: number;
  ram_used_mb: number;
  ram_total_mb: number;
  disk_used_gb: number;
  disk_total_gb: number;
}

interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exit_code: number;
}

type PredefinedCommand =
  | "get_process_list"
  | "get_services_status"
  | "clear_temp"
  | "flush_dns"
  | "get_event_log"
  | "ping_gateway"
  | "get_disk_usage"
  | "get_network_info";

const PREDEFINED_COMMANDS: { id: PredefinedCommand; label: string; icon: string }[] = [
  { id: "get_process_list", label: "Process List", icon: "list_alt" },
  { id: "get_services_status", label: "Services Status", icon: "settings_suggest" },
  { id: "get_disk_usage", label: "Disk Usage", icon: "hard_drive" },
  { id: "get_network_info", label: "Network Info", icon: "lan" },
  { id: "get_event_log", label: "Event Log (last 20)", icon: "receipt_long" },
  { id: "ping_gateway", label: "Ping 8.8.8.8", icon: "network_ping" },
  { id: "flush_dns", label: "Flush DNS", icon: "sync" },
  { id: "clear_temp", label: "Clear Temp Files", icon: "delete_sweep" },
];

const formatUptime = (secs: number) => {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const ManagementPanel: Component = () => {
  const [isAdmin, setIsAdmin] = createSignal(false);
  const [info, setInfo] = createSignal<DeviceInfo | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [cmdOutput, setCmdOutput] = createSignal<CommandResult | null>(null);
  const [runningCmd, setRunningCmd] = createSignal<string | null>(null);
  const [confirmAction, setConfirmAction] = createSignal<string | null>(null);
  const [shutdownDelay, setShutdownDelay] = createSignal(30);

  onMount(async () => {
    const admin = await invoke<boolean>("is_admin");
    setIsAdmin(admin);
    await refreshInfo();
  });

  const refreshInfo = async () => {
    try {
      const d = await invoke<DeviceInfo>("get_device_info_cmd");
      setInfo(d);
    } catch (e) {
      console.error("Failed to get device info:", e);
    }
  };

  const runPredefined = async (cmd: PredefinedCommand) => {
    setRunningCmd(cmd);
    setCmdOutput(null);
    try {
      const result = await invoke<CommandResult>("run_predefined_cmd", { cmd });
      setCmdOutput(result);
    } catch (e: any) {
      setCmdOutput({ success: false, stdout: "", stderr: String(e), exit_code: -1 });
    } finally {
      setRunningCmd(null);
    }
  };

  const performAction = async (action: string) => {
    setLoading(true);
    try {
      switch (action) {
        case "lock":
          await invoke("lock_screen_cmd");
          break;
        case "logoff":
          await invoke("logoff_user_cmd");
          break;
        case "restart":
          await invoke("restart_system_cmd", { delaySecs: shutdownDelay() });
          break;
        case "shutdown":
          await invoke("shutdown_system_cmd", { delaySecs: shutdownDelay() });
          break;
        case "abort":
          await invoke("abort_shutdown_cmd");
          break;
      }
    } catch (e: any) {
      alert(`Error: ${e}`);
    } finally {
      setLoading(false);
      setConfirmAction(null);
    }
  };

  const pct = (used: number, total: number) =>
    total > 0 ? Math.round((used / total) * 100) : 0;

  return (
    <div class="management-panel">
      <div class="panel-header">
        <h2>Device Management</h2>
        <button class="btn btn--secondary btn--sm" onClick={refreshInfo}>
          Refresh
        </button>
      </div>

      <Show when={!isAdmin()}>
        <div class="management-no-admin">
          <span class="mi" style="font-size:40px">lock</span>
          <p>Device management requires administrator elevation.</p>
          <p class="text-muted">Please run BetterDesk as Administrator to use this panel.</p>
        </div>
      </Show>

      <Show when={isAdmin()}>
        {/* Device Info */}
        <Show when={info()}>
          <div class="management-section">
            <h3>System Information</h3>
            <div class="info-grid">
              <div class="info-item">
                <span class="info-item__label">Hostname</span>
                <span class="info-item__value">{info()!.hostname}</span>
              </div>
              <div class="info-item">
                <span class="info-item__label">User</span>
                <span class="info-item__value">{info()!.current_user}</span>
              </div>
              <div class="info-item info-item--wide">
                <span class="info-item__label">OS</span>
                <span class="info-item__value">{info()!.os}</span>
              </div>
              <div class="info-item">
                <span class="info-item__label">Uptime</span>
                <span class="info-item__value">{formatUptime(info()!.uptime_secs)}</span>
              </div>
              <div class="info-item">
                <span class="info-item__label">CPU</span>
                <span class="info-item__value">{info()!.cpu_usage.toFixed(1)}%</span>
              </div>
            </div>

            <div class="resource-bars">
              <div class="resource-bar">
                <div class="resource-bar__label">
                  <span>RAM</span>
                  <span>{info()!.ram_used_mb} / {info()!.ram_total_mb} MB ({pct(info()!.ram_used_mb, info()!.ram_total_mb)}%)</span>
                </div>
                <div class="resource-bar__track">
                  <div
                    class="resource-bar__fill"
                    style={{ width: `${pct(info()!.ram_used_mb, info()!.ram_total_mb)}%` }}
                  />
                </div>
              </div>
              <div class="resource-bar">
                <div class="resource-bar__label">
                  <span>Disk</span>
                  <span>{info()!.disk_used_gb.toFixed(1)} / {info()!.disk_total_gb.toFixed(1)} GB ({pct(info()!.disk_used_gb, info()!.disk_total_gb)}%)</span>
                </div>
                <div class="resource-bar__track">
                  <div
                    class="resource-bar__fill"
                    style={{ width: `${pct(info()!.disk_used_gb, info()!.disk_total_gb)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </Show>

        {/* Session Control */}
        <div class="management-section">
          <h3>Session Control</h3>
          <div class="session-actions">
            <button
              class="btn btn--warning"
              onClick={() => setConfirmAction("lock")}
              disabled={loading()}
            >
              <span class="mi mi-sm">lock</span> Lock Screen
            </button>
            <button
              class="btn btn--warning"
              onClick={() => setConfirmAction("logoff")}
              disabled={loading()}
            >
              <span class="mi mi-sm">logout</span> Log Off User
            </button>
          </div>

          <div class="shutdown-controls">
            <h4>System Power</h4>
            <div class="shutdown-delay-row">
              <label>Delay (seconds):</label>
              <input
                type="number"
                class="input input--sm"
                value={shutdownDelay()}
                min={0}
                max={3600}
                onInput={(e) => setShutdownDelay(Number(e.currentTarget.value))}
              />
            </div>
            <div class="session-actions">
              <button
                class="btn btn--danger"
                onClick={() => setConfirmAction("restart")}
                disabled={loading()}
              >
                <span class="mi mi-sm">restart_alt</span> Restart
              </button>
              <button
                class="btn btn--danger"
                onClick={() => setConfirmAction("shutdown")}
                disabled={loading()}
              >
                <span class="mi mi-sm">power_settings_new</span> Shutdown
              </button>
              <button
                class="btn btn--secondary"
                onClick={() => performAction("abort")}
                disabled={loading()}
              >
                <span class="mi mi-sm">cancel</span> Abort
              </button>
            </div>
          </div>
        </div>

        {/* Predefined commands */}
        <div class="management-section">
          <h3>Diagnostics</h3>
          <div class="predefined-commands-grid">
            <For each={PREDEFINED_COMMANDS}>
              {(cmd) => (
                <button
                  class={`predefined-cmd-btn ${runningCmd() === cmd.id ? "predefined-cmd-btn--running" : ""}`}
                  onClick={() => runPredefined(cmd.id)}
                  disabled={runningCmd() !== null}
                >
                  <span class="mi predefined-cmd-btn__icon">{cmd.icon}</span>
                  <span class="predefined-cmd-btn__label">{cmd.label}</span>
                  <Show when={runningCmd() === cmd.id}>
                    <span class="spinner spinner--sm" />
                  </Show>
                </button>
              )}
            </For>
          </div>

          <Show when={cmdOutput()}>
            <div class={`cmd-output ${cmdOutput()!.success ? "cmd-output--ok" : "cmd-output--err"}`}>
              <div class="cmd-output__header">
                Exit code: {cmdOutput()!.exit_code}
                <button class="btn btn--ghost btn--xs" onClick={() => setCmdOutput(null)}><span class="mi mi-sm">close</span></button>
              </div>
              <pre class="cmd-output__body">{cmdOutput()!.stdout || cmdOutput()!.stderr}</pre>
            </div>
          </Show>
        </div>
      </Show>

      {/* Confirmation dialog */}
      <Show when={confirmAction()}>
        <div class="confirm-overlay">
          <div class="confirm-dialog">
            <h3>Confirm Action</h3>
            <p>
              {confirmAction() === "lock" && "Lock the workstation screen?"}
              {confirmAction() === "logoff" && "Log off the current user?"}
              {confirmAction() === "restart" && `Restart the system in ${shutdownDelay()} seconds?`}
              {confirmAction() === "shutdown" && `Shut down the system in ${shutdownDelay()} seconds?`}
            </p>
            <div class="confirm-dialog__actions">
              <button
                class="btn btn--danger"
                onClick={() => performAction(confirmAction()!)}
                disabled={loading()}
              >
                {loading() ? "Working…" : "Confirm"}
              </button>
              <button
                class="btn btn--secondary"
                onClick={() => setConfirmAction(null)}
                disabled={loading()}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default ManagementPanel;
