import { Component, createSignal, onMount, onCleanup, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { settingsStore } from "../stores/settings";
import { t } from "../lib/i18n";

interface DiscoveredServer {
  name: string;
  version: string;
  address: string;
  port: number;
  api_port: number;
  protocol: string;
  public_key: string;
  addresses: string[];
  console_url: string;
  server_address: string;
  last_seen_ms: number;
}

interface MdnsServer {
  name: string;
  host: string;
  port: number;
  addresses: string[];
  version: string;
  api_port: number;
  protocol: string;
  public_key: string;
  console_url: string;
  server_address: string;
}

interface DiscoveryStatus {
  scanning: boolean;
  servers: DiscoveredServer[];
  scans_completed: number;
  last_error: string | null;
}

/** Unified server entry combining UDP broadcast and mDNS results. */
interface UnifiedServer {
  name: string;
  address: string;
  version: string;
  port: number;
  api_port: number;
  protocol: string;
  public_key: string;
  console_url: string;
  server_address: string;
  source: "udp" | "mdns" | "both";
}

interface ConnectStep {
  step: string;
  status: "ok" | "warn" | "error" | "skip";
  detail: string;
  version?: string;
  device_id?: string;
}

interface ConnectResult {
  success: boolean;
  error?: string;
  steps: ConnectStep[];
  server_address?: string;
  console_url?: string;
  server_key?: string;
}

type Phase = "idle" | "connecting" | "success" | "error";

const STEP_LABELS: Record<string, string> = {
  api: "Server API",
  console: "Web Console",
  signal: "Signal Server",
  config: "Save Config",
  register: "Registration",
};

const STEP_ORDER = ["api", "console", "signal", "config", "register"];

const DiscoveryPanel: Component = () => {
  const [serverAddress, setServerAddress] = createSignal("");
  const [phase, setPhase] = createSignal<Phase>("idle");
  const [steps, setSteps] = createSignal<ConnectStep[]>([]);
  const [errorMsg, setErrorMsg] = createSignal("");
  const [isAdmin, setIsAdmin] = createSignal(false);
  const [elevating, setElevating] = createSignal(false);
  const [showAdvanced, setShowAdvanced] = createSignal(false);

  // LAN scan (UDP broadcast + mDNS)
  const [scanning, setScanning] = createSignal(false);
  const [scanResults, setScanResults] = createSignal<UnifiedServer[]>([]);
  const [mdnsScanning, setMdnsScanning] = createSignal(false);
  let statusTimer: ReturnType<typeof setInterval> | null = null;

  onMount(async () => {
    try {
      const admin = await invoke<boolean>("is_admin");
      setIsAdmin(admin);
    } catch (_) {}

    const s = settingsStore.settings();
    if (s && s.server_address) {
      // Show just the host portion
      const addr = s.server_address;
      const host = addr.includes(":") ? addr.substring(0, addr.lastIndexOf(":")) : addr;
      setServerAddress(host);
    }
  });

  onCleanup(() => {
    if (statusTimer) clearInterval(statusTimer);
    invoke("stop_lan_discovery").catch(() => {});
  });

  const alreadyConfigured = () => {
    const s = settingsStore.settings();
    return s && (s.server_address || s.console_url);
  };

  // Main auto-connect flow
  const doConnect = async () => {
    const addr = serverAddress().trim();
    if (!addr) return;

    setPhase("connecting");
    setSteps([]);
    setErrorMsg("");

    try {
      const result = await invoke<ConnectResult>("auto_connect_server", {
        address: addr,
      });

      setSteps(result.steps || []);

      if (result.success) {
        setPhase("success");
        await settingsStore.load();
        // Registration already started by auto_connect_server — no need to call again
      } else {
        setPhase("error");
        setErrorMsg(result.error || "Connection failed");
      }
    } catch (e: any) {
      setPhase("error");
      setErrorMsg(e.toString());
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && serverAddress().trim() && phase() !== "connecting") {
      doConnect();
    }
  };

  /** Merge UDP and mDNS results, deduplicating by address. */
  const mergeResults = (
    udp: DiscoveredServer[],
    mdns: MdnsServer[]
  ): UnifiedServer[] => {
    const map = new Map<string, UnifiedServer>();

    for (const s of udp) {
      map.set(s.address, {
        name: s.name,
        address: s.address,
        version: s.version,
        port: s.port,
        api_port: s.api_port,
        protocol: s.protocol,
        public_key: s.public_key,
        console_url: s.console_url,
        server_address: s.server_address,
        source: "udp",
      });
    }

    for (const s of mdns) {
      const addr = s.addresses[0] || s.host;
      const existing = map.get(addr);
      if (existing) {
        existing.source = "both";
        // Prefer mDNS data if richer
        if (s.version && !existing.version) existing.version = s.version;
        if (s.public_key && !existing.public_key) existing.public_key = s.public_key;
      } else {
        map.set(addr, {
          name: s.name,
          address: addr,
          version: s.version,
          port: s.port,
          api_port: s.api_port,
          protocol: s.protocol,
          public_key: s.public_key,
          console_url: s.console_url,
          server_address: s.server_address,
          source: "mdns",
        });
      }
    }

    return Array.from(map.values());
  };

  // LAN scan helpers — runs UDP broadcast + mDNS in parallel
  let mdnsResults: MdnsServer[] = [];
  let udpResults: DiscoveredServer[] = [];

  const startScan = async () => {
    setShowAdvanced(true);
    setScanning(true);
    setMdnsScanning(true);
    setScanResults([]);
    mdnsResults = [];
    udpResults = [];

    // Start mDNS browse (async, ~10s timeout)
    invoke<MdnsServer[]>("discover_mdns_servers")
      .then((servers) => {
        mdnsResults = servers;
        setScanResults(mergeResults(udpResults, mdnsResults));
      })
      .catch(() => {})
      .finally(() => setMdnsScanning(false));

    // Start UDP broadcast scan
    try {
      await invoke<DiscoveryStatus>("start_lan_discovery");
      statusTimer = setInterval(async () => {
        try {
          const s = await invoke<DiscoveryStatus>("get_discovery_status");
          udpResults = s.servers;
          setScanResults(mergeResults(udpResults, mdnsResults));
          if (!s.scanning && statusTimer) {
            clearInterval(statusTimer);
            statusTimer = null;
            // Keep scanning state until both finish
            if (!mdnsScanning()) setScanning(false);
          }
        } catch (_) {}
      }, 2000);
    } catch (_) {
      if (!mdnsScanning()) setScanning(false);
    }
  };

  const selectServer = (server: UnifiedServer) => {
    setServerAddress(server.address);
    setShowAdvanced(false);
    if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
    invoke("stop_lan_discovery").catch(() => {});
    setScanning(false);
    setPhase("idle");
  };

  const stepIcon = (status: string) => {
    switch (status) {
      case "ok":
        return <span class="mi step-icon step-ok">check_circle</span>;
      case "error":
        return <span class="mi step-icon step-error">cancel</span>;
      case "warn":
      case "skip":
        return <span class="mi step-icon step-warn">warning</span>;
      default:
        return <span class="step-icon step-pending"><span class="spinner--sm" /></span>;
    }
  };

  // Elevate on demand — restart the app with admin privileges
  const doElevate = async () => {
    setElevating(true);
    try {
      await invoke("elevate_restart");
    } catch (e: any) {
      setErrorMsg(e.toString());
      setElevating(false);
    }
  };

  return (
    <div class="discovery-panel">
      <div class="panel-header">
        <h1>Server Setup</h1>
        <p class="subtitle">Connect this device to a BetterDesk server</p>
      </div>

      <Show when={!isAdmin()}>
        <div class="setup-elevation-bar">
          <div class="elevation-info">
            <span class="mi mi-sm">shield</span>
            <span>Administrator privileges required to change server settings.</span>
          </div>
          <button class="elevation-btn" onClick={doElevate} disabled={elevating()}>
            <Show when={!elevating()} fallback={<span class="spinner--sm" />}>
              <span class="mi mi-sm">shield</span>
            </Show>
            <span>{elevating() ? "Elevating..." : "Unlock"}</span>
          </button>
        </div>
      </Show>

      {/* Single input card */}
      <section class="setup-card">
        <label class="setup-label" for="setup-address">Server Address</label>
        <div class="setup-input-row">
          <input
            id="setup-address"
            type="text"
            class="setup-input"
            placeholder="e.g. 192.168.1.100 or my-server.example.com"
            value={serverAddress()}
            onInput={(e) => {
              setServerAddress(e.currentTarget.value);
              if (phase() !== "idle") { setPhase("idle"); setSteps([]); setErrorMsg(""); }
            }}
            onKeyDown={handleKeyDown}
            disabled={!isAdmin() || phase() === "connecting"}
          />
          <button
            class="setup-btn"
            onClick={doConnect}
            disabled={!serverAddress().trim() || phase() === "connecting" || !isAdmin()}
          >
            <Show when={phase() !== "connecting"} fallback={<span class="spinner--sm" />}>
              <span class="mi">arrow_forward</span>
            </Show>
            <span>{phase() === "connecting" ? "Connecting..." : "Connect"}</span>
          </button>
        </div>

        <div class="setup-hint-row">
          <span class="setup-hint">
            Just the IP or hostname — ports and keys are detected automatically.
          </span>
          <button class="setup-link" onClick={startScan} disabled={!isAdmin() || scanning()}>
            <span class="mi mi-sm">radar</span>
            {scanning() ? "Scanning..." : "Scan LAN"}
          </button>
        </div>
      </section>

      {/* Progress steps */}
      <Show when={steps().length > 0}>
        <section class="setup-steps">
          <For each={steps()}>{(s) =>
            <div class={`setup-step setup-step--${s.status}`}>
              {stepIcon(s.status)}
              <div class="step-content">
                <span class="step-label">{STEP_LABELS[s.step] || s.step}</span>
                <span class="step-detail">{s.detail}</span>
              </div>
            </div>
          }</For>
        </section>
      </Show>

      {/* Success banner */}
      <Show when={phase() === "success"}>
        <div class="setup-result setup-result--ok">
          <span class="mi mi-lg">check_circle</span>
          <div>
            <strong>Connected!</strong>
            <p>Device registered successfully. Go to <a href="/">Connect</a> to start a remote session.</p>
          </div>
        </div>
      </Show>

      {/* Error banner */}
      <Show when={phase() === "error"}>
        <div class="setup-result setup-result--err">
          <span class="mi mi-lg">error</span>
          <div>
            <strong>Connection Failed</strong>
            <p>{errorMsg()}</p>
          </div>
        </div>
      </Show>

      {/* Already configured hint */}
      <Show when={alreadyConfigured() && phase() === "idle"}>
        <div class="setup-result setup-result--info">
          <span class="mi mi-sm">info</span>
          <span>This device is already configured. Entering a new address will reconnect.</span>
        </div>
      </Show>

      {/* LAN scan results (collapsible) */}
      <Show when={showAdvanced()}>
        <section class="setup-scan">
          <div class="scan-header">
            <h3>
              <Show when={scanning()} fallback="LAN Scan Results">
                <span class="pulse" /> Scanning...
              </Show>
            </h3>
            <button class="setup-link" onClick={() => { setShowAdvanced(false); invoke("stop_lan_discovery").catch(() => {}); }}>
              Close
            </button>
          </div>
          <Show when={scanResults().length === 0 && !scanning()}>
            <div class="scan-empty">No servers found on LAN.</div>
          </Show>
          <For each={scanResults()}>{(server) =>
            <div class="scan-server" onClick={() => selectServer(server)}>
              <div class="scan-server-info">
                <strong>{server.name}</strong>
                <span class="scan-server-addr">{server.address}</span>
                <Show when={server.version}>
                  <span class="scan-server-ver">v{server.version}</span>
                </Show>
                <span class={`scan-server-source scan-source--${server.source}`}>
                  {server.source === "both" ? "UDP+mDNS" : server.source.toUpperCase()}
                </span>
              </div>
              <button class="btn-sm" onClick={(e) => { e.stopPropagation(); selectServer(server); }}>
                Use
              </button>
            </div>
          }</For>
        </section>
      </Show>
    </div>
  );
};

export default DiscoveryPanel;
