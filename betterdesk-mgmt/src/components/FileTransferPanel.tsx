import { Component, createSignal, For, Show, onMount, onCleanup } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { t, onLocaleChange } from "../lib/i18n";

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_file: boolean;
  size: number;
  modified: string | null;
  readonly: boolean;
  hidden: boolean;
}

const FileTransferPanel: Component = () => {
  const [currentPath, setCurrentPath] = createSignal("");
  const [entries, setEntries] = createSignal<FileEntry[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [showHidden, setShowHidden] = createSignal(false);
  const [, setLocaleVer] = createSignal(0);

  onMount(() => {
    const unsub = onLocaleChange(() => setLocaleVer((v) => v + 1));
    browseTo(getDefaultPath());
    onCleanup(unsub);
  });

  function getDefaultPath(): string {
    const isWin = navigator.userAgent.includes("Windows");
    return isWin ? "C:\\" : "/";
  }

  async function browseTo(path: string) {
    setLoading(true);
    setError("");
    try {
      const result = await invoke<{ path: string; entries: FileEntry[]; parent: string | null }>(
        "browse_local_files",
        { path, showHidden: showHidden() }
      );
      setCurrentPath(result.path);
      setEntries(result.entries);
    } catch (e: any) {
      setError(String(e));
    }
    setLoading(false);
  }

  function goUp() {
    const parts = currentPath().replace(/\\/g, "/").split("/").filter(Boolean);
    if (parts.length > 1) {
      parts.pop();
      const parent = currentPath().includes("\\")
        ? parts.join("\\") + "\\"
        : "/" + parts.join("/");
      browseTo(parent);
    } else {
      browseTo(getDefaultPath());
    }
  }

  function formatSize(bytes: number): string {
    if (bytes === 0) return "—";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) {
      size /= 1024;
      i++;
    }
    return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
  }

  return (
    <div class="panel">
      <div class="panel-header">
        <h2>
          <span class="mi">folder_open</span>
          {t("file_transfer.title")}
        </h2>
      </div>

      <div class="panel-toolbar" style="display:flex;gap:8px;align-items:center;padding:8px 16px;border-bottom:1px solid var(--border)">
        <button class="btn btn-sm" onClick={goUp} title={t("file_transfer.go_up")}>
          <span class="mi">arrow_upward</span>
        </button>
        <input
          type="text"
          class="input input-sm"
          style="flex:1"
          value={currentPath()}
          onKeyDown={(e) => {
            if (e.key === "Enter") browseTo(e.currentTarget.value);
          }}
        />
        <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--text-secondary)">
          <input
            type="checkbox"
            checked={showHidden()}
            onChange={(e) => {
              setShowHidden(e.currentTarget.checked);
              browseTo(currentPath());
            }}
          />
          {t("file_transfer.show_hidden")}
        </label>
      </div>

      <Show when={error()}>
        <div class="alert alert-error" style="margin:8px 16px">{error()}</div>
      </Show>

      <Show when={loading()}>
        <div class="panel-loading" style="padding:32px;text-align:center">
          <div class="spinner" />
        </div>
      </Show>

      <Show when={!loading() && entries().length === 0 && !error()}>
        <div style="padding:32px;text-align:center;color:var(--text-secondary)">
          {t("file_transfer.empty_dir")}
        </div>
      </Show>

      <div class="file-list" style="overflow-y:auto;max-height:calc(100vh - 200px)">
        <For each={entries()}>
          {(entry) => (
            <div
              class={`file-entry ${entry.is_dir ? "file-entry--dir" : ""}`}
              style="display:flex;align-items:center;gap:8px;padding:6px 16px;border-bottom:1px solid var(--border);cursor:pointer"
              onClick={() => entry.is_dir && browseTo(entry.path)}
              onDblClick={() => !entry.is_dir && invoke("open_file_native", { path: entry.path }).catch(() => {})}
            >
              <span class="mi" style={`font-size:20px;color:${entry.is_dir ? "var(--primary)" : "var(--text-secondary)"}`}>
                {entry.is_dir ? "folder" : "description"}
              </span>
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                {entry.name}
              </span>
              <span style="font-size:12px;color:var(--text-secondary);min-width:70px;text-align:right">
                {entry.is_file ? formatSize(entry.size) : ""}
              </span>
              <span style="font-size:11px;color:var(--text-tertiary);min-width:130px;text-align:right">
                {entry.modified || ""}
              </span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};

export default FileTransferPanel;
