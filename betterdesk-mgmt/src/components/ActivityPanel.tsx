import { Component, createSignal, For, Show, onMount, onCleanup } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { t, onLocaleChange } from "../lib/i18n";

interface ActivityEntry {
  action: string;
  target: string;
  timestamp: string;
  details: string;
}

const ActivityPanel: Component = () => {
  const [entries, setEntries] = createSignal<ActivityEntry[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [filter, setFilter] = createSignal("all");
  const [, setLocaleVer] = createSignal(0);

  onMount(() => {
    const unsub = onLocaleChange(() => setLocaleVer((v) => v + 1));
    loadActivity();
    const interval = setInterval(loadActivity, 30000);
    onCleanup(() => {
      unsub();
      clearInterval(interval);
    });
  });

  async function loadActivity() {
    setLoading(true);
    try {
      const log = await invoke<ActivityEntry[]>("get_activity_log");
      setEntries(log);
    } catch (e) {
      // Activity tracking may not be available
      setEntries([]);
    }
    setLoading(false);
  }

  function filteredEntries() {
    const f = filter();
    if (f === "all") return entries();
    return entries().filter((e) => e.action === f);
  }

  function getActionIcon(action: string): string {
    switch (action) {
      case "connection": return "link";
      case "login": return "login";
      case "file_transfer": return "file_copy";
      case "remote_session": return "screen_share";
      case "command": return "terminal";
      default: return "info";
    }
  }

  function getActionColor(action: string): string {
    switch (action) {
      case "connection": return "var(--primary)";
      case "login": return "var(--success)";
      case "file_transfer": return "var(--warning)";
      case "remote_session": return "var(--info)";
      default: return "var(--text-secondary)";
    }
  }

  return (
    <div class="panel">
      <div class="panel-header">
        <h2>
          <span class="mi">history</span>
          {t("activity.title")}
        </h2>
        <button class="btn btn-sm" onClick={loadActivity}>
          <span class="mi">refresh</span>
        </button>
      </div>

      <div style="display:flex;gap:8px;padding:8px 16px;border-bottom:1px solid var(--border)">
        <button class={`btn btn-sm ${filter() === "all" ? "btn-primary" : ""}`} onClick={() => setFilter("all")}>
          {t("activity.filter_all")}
        </button>
        <button class={`btn btn-sm ${filter() === "connection" ? "btn-primary" : ""}`} onClick={() => setFilter("connection")}>
          {t("activity.filter_connections")}
        </button>
        <button class={`btn btn-sm ${filter() === "login" ? "btn-primary" : ""}`} onClick={() => setFilter("login")}>
          {t("activity.filter_logins")}
        </button>
        <button class={`btn btn-sm ${filter() === "remote_session" ? "btn-primary" : ""}`} onClick={() => setFilter("remote_session")}>
          {t("activity.filter_sessions")}
        </button>
      </div>

      <Show when={loading()}>
        <div style="padding:32px;text-align:center">
          <div class="spinner" />
        </div>
      </Show>

      <Show when={!loading() && filteredEntries().length === 0}>
        <div style="padding:32px;text-align:center;color:var(--text-secondary)">
          <span class="mi" style="font-size:48px;display:block;margin-bottom:12px">event_note</span>
          {t("activity.no_entries")}
        </div>
      </Show>

      <div style="overflow-y:auto;max-height:calc(100vh - 180px)">
        <For each={filteredEntries()}>
          {(entry) => (
            <div style="display:flex;align-items:flex-start;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border)">
              <span class="mi" style={`font-size:20px;color:${getActionColor(entry.action)};margin-top:2px`}>
                {getActionIcon(entry.action)}
              </span>
              <div style="flex:1;min-width:0">
                <div style="font-weight:500">{entry.target}</div>
                <div style="font-size:12px;color:var(--text-secondary);margin-top:2px">{entry.details}</div>
              </div>
              <div style="font-size:11px;color:var(--text-tertiary);white-space:nowrap">{entry.timestamp}</div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};

export default ActivityPanel;
