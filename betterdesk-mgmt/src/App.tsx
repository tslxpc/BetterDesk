import { Component, Show, createSignal, onMount, ErrorBoundary } from "solid-js";
import { Router, Route, useNavigate, useLocation } from "@solidjs/router";
import Sidebar from "./components/Sidebar";
import Dashboard from "./components/Dashboard";
import ConnectionPanel from "./components/ConnectionPanel";
import RemoteAgentPanel from "./components/RemoteAgentPanel";
import SettingsPanel from "./components/SettingsPanel";
import InventoryPanel from "./components/InventoryPanel";
import ManagementPanel from "./components/ManagementPanel";
import CdapPanel from "./components/CdapPanel";
import HelpRequestPanel from "./components/HelpRequestPanel";
import OperatorPanel from "./components/OperatorPanel";
import DiscoveryPanel from "./components/DiscoveryPanel";
import OrgLoginPanel from "./components/OrgLoginPanel";
import FileTransferPanel from "./components/FileTransferPanel";
import DataGuardPanel from "./components/DataGuardPanel";
import AutomationPanel from "./components/AutomationPanel";
import ActivityPanel from "./components/ActivityPanel";
import ServerPanel from "./components/ServerPanel";
import NotificationCenter from "./components/NotificationCenter";
import SetupWizard from "./components/SetupWizard";
import RemoteBadge from "./components/RemoteBadge";
import { settingsStore } from "./stores/settings";
import { initI18n } from "./lib/i18n";

// Expose navigation function for tray menu (called via window.eval from Rust)
declare global {
  interface Window {
    __navigate?: (path: string) => void;
  }
}

const Layout: Component<{ children?: any }> = (props) => {
  const location = useLocation();
  const navigate = useNavigate();

  onMount(() => {
    // Register global navigation handler for tray menu events
    window.__navigate = (path: string) => {
      navigate(path);
    };
  });

  return (
    <div class="app-layout">
      <Sidebar currentPath={location.pathname} />
      <main class="main-content">
        {props.children}
      </main>
      <RemoteBadge />
    </div>
  );
};

const App: Component = () => {
  const [ready, setReady] = createSignal(false);
  const [loading, setLoading] = createSignal(true);
  const [initError, setInitError] = createSignal("");

  onMount(async () => {
    try {
      await settingsStore.load();
      const s = settingsStore.settings();

      // Initialize i18n with user preference (falls back to system locale)
      await initI18n(s?.language || undefined);

      // Show main UI immediately if server is already configured
      if (s && (s.server_address || s.console_url)) {
        setReady(true);
      }
    } catch (e: any) {
      console.error("[App] Init failed:", e);
      setInitError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  });

  const handleSetupComplete = async () => {
    // Reload settings after wizard completes
    await settingsStore.load();
    setReady(true);
  };

  return (
    <ErrorBoundary fallback={(err) => (
      <div style="color:#ff6b6b;background:#1a1a2e;padding:24px;font-family:monospace;white-space:pre-wrap;height:100vh;overflow:auto">
        <h2 style="color:#fff">BetterDesk MGMT — Render Error</h2>
        <p>{err?.message || String(err)}</p>
        <pre style="font-size:12px;opacity:0.7">{err?.stack}</pre>
      </div>
    )}>
      <Show when={!initError()} fallback={
        <div style="color:#ff6b6b;background:#1a1a2e;padding:24px;font-family:monospace;white-space:pre-wrap;height:100vh">
          <h2 style="color:#fff">BetterDesk MGMT — Init Error</h2>
          <p>{initError()}</p>
        </div>
      }>
        <Show when={!loading()} fallback={<div class="wizard-overlay" />}>
          <Show
            when={ready()}
            fallback={<SetupWizard onComplete={handleSetupComplete} />}
          >
            <Router root={Layout}>
              <Route path="/" component={Dashboard} />
              <Route path="/connection" component={ConnectionPanel} />
              <Route path="/remote" component={RemoteAgentPanel} />
              <Route path="/inventory" component={InventoryPanel} />
              <Route path="/management" component={ManagementPanel} />
              <Route path="/cdap" component={CdapPanel} />
              <Route path="/discovery" component={DiscoveryPanel} />
              <Route path="/help-request" component={HelpRequestPanel} />
              <Route path="/operator" component={OperatorPanel} />
              <Route path="/org-login" component={OrgLoginPanel} />
              <Route path="/files" component={FileTransferPanel} />
              <Route path="/dataguard" component={DataGuardPanel} />
              <Route path="/automation" component={AutomationPanel} />
              <Route path="/activity" component={ActivityPanel} />
              <Route path="/server" component={ServerPanel} />
              <Route path="/notifications" component={NotificationCenter} />
              <Route path="/settings" component={SettingsPanel} />
            </Router>
          </Show>
        </Show>
      </Show>
    </ErrorBoundary>
  );
};

export default App;
