import { Component, createSignal, onMount, onCleanup, Show } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../lib/i18n";

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

interface RemoteSessionInfo {
  active: boolean;
  peer_id: string;
  peer_name: string;
  connected_at: number;
  encrypted: boolean;
}

// ---------------------------------------------------------------------------
//  RemoteBadge — small overlay shown during active incoming sessions
// ---------------------------------------------------------------------------

const RemoteBadge: Component = () => {
  const [session, setSession] = createSignal<RemoteSessionInfo | null>(null);
  const [collapsed, setCollapsed] = createSignal(true);
  const [elapsed, setElapsed] = createSignal("00:00");

  let elapsedTimer: ReturnType<typeof setInterval> | undefined;

  const updateElapsed = () => {
    const s = session();
    if (!s || !s.connected_at) return;
    const diff = Math.floor((Date.now() - s.connected_at) / 1000);
    const hrs = Math.floor(diff / 3600);
    const mins = Math.floor((diff % 3600) / 60);
    const secs = diff % 60;
    if (hrs > 0) {
      setElapsed(`${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`);
    } else {
      setElapsed(`${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`);
    }
  };

  const disconnect = async () => {
    try {
      await invoke("stop_remote_session");
    } catch (_) {}
  };

  const openChat = async () => {
    try {
      await invoke("open_chat_window");
    } catch (_) {}
  };

  onMount(async () => {
    const unsubStart = await listen<RemoteSessionInfo>("remote-session-start", (e) => {
      setSession(e.payload);
      setCollapsed(false);
      elapsedTimer = setInterval(updateElapsed, 1000);
    });

    const unsubEnd = await listen("remote-session-end", () => {
      setSession(null);
      setCollapsed(true);
      if (elapsedTimer) clearInterval(elapsedTimer);
    });

    // Also check current status
    try {
      const status = await invoke<any>("get_remote_status");
      if (status?.streaming) {
        setSession({
          active: true,
          peer_id: status.peer_id || "Unknown",
          peer_name: status.peer_name || "Remote User",
          connected_at: Date.now(),
          encrypted: true,
        });
        setCollapsed(false);
        elapsedTimer = setInterval(updateElapsed, 1000);
      }
    } catch (_) {}

    onCleanup(() => {
      unsubStart();
      unsubEnd();
      if (elapsedTimer) clearInterval(elapsedTimer);
    });
  });

  return (
    <Show when={session()}>
      <div class={`rb ${collapsed() ? "rb--collapsed" : ""}`}>
        {/* Collapsed: just a small tab */}
        <Show when={collapsed()}>
          <button class="rb-tab" onClick={() => setCollapsed(false)} title="Remote session active">
            <span class="mi mi-sm">screen_share</span>
          </button>
        </Show>

        {/* Expanded: full badge */}
        <Show when={!collapsed()}>
          <div class="rb-panel">
            <div class="rb-header">
              <span class="mi mi-sm">screen_share</span>
              <span class="rb-title">Remote Session</span>
              <button class="rb-collapse" onClick={() => setCollapsed(true)} title="Collapse">
                <span class="mi mi-sm">keyboard_arrow_right</span>
              </button>
            </div>

            <div class="rb-body">
              <div class="rb-info-row">
                <span class="rb-label">Connected:</span>
                <span class="rb-value">{session()!.peer_name || session()!.peer_id}</span>
              </div>
              <div class="rb-info-row">
                <span class="rb-label">Duration:</span>
                <span class="rb-value rb-timer">{elapsed()}</span>
              </div>
              <Show when={session()!.encrypted}>
                <div class="rb-info-row rb-encrypted">
                  <span class="mi mi-sm">lock</span>
                  <span>Encrypted</span>
                </div>
              </Show>
            </div>

            <div class="rb-actions">
              <button class="rb-btn rb-btn--chat" onClick={openChat} title="Chat with operator">
                <span class="mi mi-sm">chat</span>
              </button>
              <button class="rb-btn rb-btn--disconnect" onClick={disconnect} title="Disconnect">
                <span class="mi mi-sm">call_end</span>
                <span>End</span>
              </button>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  );
};

export default RemoteBadge;
