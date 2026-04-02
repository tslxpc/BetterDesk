import { Component, createSignal, onMount, onCleanup } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { t } from "../lib/i18n";

interface RemoteStatus {
  active: boolean;
  standby: boolean;
  frame_count: number;
  fps: number;
  width: number;
  height: number;
  error: string | null;
}

const RemoteAgentPanel: Component = () => {
  const [status, setStatus] = createSignal<RemoteStatus>({
    active: false,
    standby: false,
    frame_count: 0,
    fps: 0,
    width: 0,
    height: 0,
    error: null,
  });

  const loadStatus = async () => {
    try {
      const s = await invoke<RemoteStatus>("get_remote_status");
      setStatus(s);
    } catch (e) {
      console.error("Failed to load remote status:", e);
    }
  };

  onMount(async () => {
    await loadStatus();

    const unsub = await listen<RemoteStatus>("remote-status", (event) => {
      setStatus(event.payload);
    });

    const poll = setInterval(loadStatus, 3000);

    onCleanup(() => {
      unsub();
      clearInterval(poll);
    });
  });

  const getStatusLabel = () => {
    if (status().active) return { text: "Active — Streaming", cls: "status-active" };
    if (status().standby) return { text: "Standby — Waiting for operator", cls: "status-standby" };
    return { text: "Offline — Not connected", cls: "status-offline" };
  };

  return (
    <div class="remote-agent-panel">
      <div class="panel-header">
        <h2>Remote Desktop Agent</h2>
      </div>

      <div class="remote-agent-status-card">
        <div class={`remote-status-indicator ${getStatusLabel().cls}`}>
          <div class="remote-status-icon">
            <span class="mi" style="font-size:48px">screen_share</span>
          </div>
          <div class="remote-status-text">
            <span class="remote-status-label">{getStatusLabel().text}</span>
          </div>
        </div>

        <div class="remote-stats-grid">
          <div class="remote-stat">
            <span class="remote-stat__label">State</span>
            <span class="remote-stat__value">{getStatusLabel().text.split("—")[0].trim()}</span>
          </div>
          <div class="remote-stat">
            <span class="remote-stat__label">Frames sent</span>
            <span class="remote-stat__value">{status().frame_count.toLocaleString()}</span>
          </div>
          <div class="remote-stat">
            <span class="remote-stat__label">Resolution</span>
            <span class="remote-stat__value">
              {status().width > 0 ? `${status().width}×${status().height}` : "—"}
            </span>
          </div>
          <div class="remote-stat">
            <span class="remote-stat__label">FPS</span>
            <span class="remote-stat__value">{status().fps > 0 ? status().fps.toFixed(1) : "—"}</span>
          </div>
        </div>

        {status().error && (
          <div class="remote-error-notice">
            <span class="mi mi-sm">warning</span>
            {status().error}
          </div>
        )}
      </div>

      <div class="remote-agent-info">
        <h3>How Remote Desktop Works</h3>
        <ol class="remote-info-steps">
          <li>The agent connects to the BetterDesk server and waits in standby mode.</li>
          <li>When an operator opens <strong>Remote → Connect</strong> in the web console, the agent activates.</li>
          <li>The agent streams your screen at up to 15 FPS and forwards the operator's mouse and keyboard inputs.</li>
          <li>The session ends when the operator disconnects or closes the viewer.</li>
        </ol>
        <p class="text-muted">
          The agent is in standby mode — it does not capture or transmit any data until an operator initiates a session.
        </p>
      </div>
    </div>
  );
};

export default RemoteAgentPanel;
