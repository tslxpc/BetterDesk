import { Component, Show, For, createSignal, onMount, onCleanup } from "solid-js";
import { api, type InventoryStatus, type HardwareInfo } from "../lib/tauri";
import { t } from "../lib/i18n";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const InventoryPanel: Component = () => {
  const [status, setStatus] = createSignal<InventoryStatus | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  let pollInterval: ReturnType<typeof setInterval> | null = null;

  const fetchStatus = async () => {
    try {
      const s = await api.getInventoryStatus();
      setStatus(s);
      setError(null);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  onMount(() => {
    fetchStatus();
    pollInterval = setInterval(fetchStatus, 5000);
  });

  onCleanup(() => {
    if (pollInterval) clearInterval(pollInterval);
  });

  const handleCollect = async () => {
    setLoading(true);
    try {
      const hw = await api.collectInventoryNow();
      // Refresh status after collection
      await fetchStatus();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const hw = () => status()?.hardware ?? null;
  const memPercent = () => {
    const h = hw();
    if (!h || h.memory.total_bytes === 0) return 0;
    return Math.round((h.memory.used_bytes / h.memory.total_bytes) * 100);
  };

  return (
    <div class="inventory-panel">
      <div class="panel-header">
        <h1>System Inventory</h1>
        <p class="subtitle">Hardware & software information</p>
      </div>

      <div class="inventory-actions">
        <button
          class="btn-primary"
          onClick={handleCollect}
          disabled={loading()}
        >
          <Show when={!loading()} fallback={<span class="spinner" />}>
            Collect Now
          </Show>
        </button>
        <Show when={status()?.running}>
          <span class="inv-status-badge online">Collector Running</span>
        </Show>
        <Show when={status() && !status()!.running}>
          <span class="inv-status-badge offline">Collector Stopped</span>
        </Show>
        <Show when={status()?.last_upload_at}>
          <span class="inv-meta">
            Last upload: {new Date(status()!.last_upload_at!).toLocaleString()}
            {" "}({status()!.upload_count} total)
          </span>
        </Show>
      </div>

      <Show when={error()}>
        <div class="error-banner">
          <span>{error()}</span>
        </div>
      </Show>

      <Show when={hw()}>
        <div class="inventory-grid">
          {/* System */}
          <section class="inv-card">
            <h2>System</h2>
            <div class="inv-rows">
              <div class="inv-row">
                <span class="inv-label">Hostname</span>
                <span class="inv-value">{hw()!.hostname}</span>
              </div>
              <div class="inv-row">
                <span class="inv-label">OS</span>
                <span class="inv-value">{hw()!.os_name} {hw()!.os_version}</span>
              </div>
              <div class="inv-row">
                <span class="inv-label">Kernel</span>
                <span class="inv-value">{hw()!.kernel_version}</span>
              </div>
              <div class="inv-row">
                <span class="inv-label">Architecture</span>
                <span class="inv-value">{hw()!.architecture}</span>
              </div>
              <div class="inv-row">
                <span class="inv-label">Uptime</span>
                <span class="inv-value">{formatUptime(hw()!.uptime_secs)}</span>
              </div>
            </div>
          </section>

          {/* CPU */}
          <section class="inv-card">
            <h2>CPU</h2>
            <div class="inv-rows">
              <div class="inv-row">
                <span class="inv-label">Model</span>
                <span class="inv-value">{hw()!.cpu.brand}</span>
              </div>
              <div class="inv-row">
                <span class="inv-label">Cores</span>
                <span class="inv-value">
                  {hw()!.cpu.physical_cores} physical / {hw()!.cpu.logical_cores} logical
                </span>
              </div>
              <div class="inv-row">
                <span class="inv-label">Frequency</span>
                <span class="inv-value">{hw()!.cpu.frequency_mhz} MHz</span>
              </div>
              <div class="inv-row">
                <span class="inv-label">Usage</span>
                <span class="inv-value">
                  <div class="progress-bar">
                    <div
                      class="progress-fill"
                      style={`width: ${hw()!.cpu.usage_percent}%`}
                      classList={{ warning: hw()!.cpu.usage_percent > 80 }}
                    />
                  </div>
                  <span>{hw()!.cpu.usage_percent.toFixed(1)}%</span>
                </span>
              </div>
            </div>
          </section>

          {/* Memory */}
          <section class="inv-card">
            <h2>Memory</h2>
            <div class="inv-rows">
              <div class="inv-row">
                <span class="inv-label">Total</span>
                <span class="inv-value">{formatBytes(hw()!.memory.total_bytes)}</span>
              </div>
              <div class="inv-row">
                <span class="inv-label">Used</span>
                <span class="inv-value">{formatBytes(hw()!.memory.used_bytes)}</span>
              </div>
              <div class="inv-row">
                <span class="inv-label">Available</span>
                <span class="inv-value">{formatBytes(hw()!.memory.available_bytes)}</span>
              </div>
              <div class="inv-row">
                <span class="inv-label">Usage</span>
                <span class="inv-value">
                  <div class="progress-bar">
                    <div
                      class="progress-fill"
                      style={`width: ${memPercent()}%`}
                      classList={{ warning: memPercent() > 85 }}
                    />
                  </div>
                  <span>{memPercent()}%</span>
                </span>
              </div>
              <Show when={hw()!.memory.swap_total_bytes > 0}>
                <div class="inv-row">
                  <span class="inv-label">Swap</span>
                  <span class="inv-value">
                    {formatBytes(hw()!.memory.swap_used_bytes)} / {formatBytes(hw()!.memory.swap_total_bytes)}
                  </span>
                </div>
              </Show>
            </div>
          </section>

          {/* Disks */}
          <section class="inv-card">
            <h2>Disks ({hw()!.disks.length})</h2>
            <div class="inv-rows">
              <For each={hw()!.disks}>
                {(disk) => {
                  const usedBytes = disk.total_bytes - disk.available_bytes;
                  const usedPct = disk.total_bytes > 0
                    ? Math.round((usedBytes / disk.total_bytes) * 100)
                    : 0;
                  return (
                    <div class="inv-disk-entry">
                      <div class="inv-row">
                        <span class="inv-label">{disk.mount_point}</span>
                        <span class="inv-value">
                          {formatBytes(usedBytes)} / {formatBytes(disk.total_bytes)}
                          {disk.is_removable ? " (removable)" : ""}
                        </span>
                      </div>
                      <div class="progress-bar">
                        <div
                          class="progress-fill"
                          style={`width: ${usedPct}%`}
                          classList={{ warning: usedPct > 90 }}
                        />
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          </section>

          {/* Network */}
          <section class="inv-card">
            <h2>Network ({hw()!.network_interfaces.length})</h2>
            <div class="inv-rows">
              <For each={hw()!.network_interfaces}>
                {(nic) => (
                  <div class="inv-nic-entry">
                    <div class="inv-row">
                      <span class="inv-label">{nic.name}</span>
                      <span class="inv-value">{nic.mac_address}</span>
                    </div>
                    <div class="inv-row">
                      <span class="inv-label">IPs</span>
                      <span class="inv-value">{nic.ip_addresses.join(", ") || "—"}</span>
                    </div>
                    <div class="inv-row">
                      <span class="inv-label">Traffic</span>
                      <span class="inv-value">
                        ↓ {formatBytes(nic.rx_bytes)} / ↑ {formatBytes(nic.tx_bytes)}
                      </span>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </section>
        </div>
      </Show>

      <Show when={!hw() && !error()}>
        <div class="inv-empty">
          <p>No inventory data available yet. Click "Collect Now" to gather system information.</p>
        </div>
      </Show>
    </div>
  );
};

export default InventoryPanel;
