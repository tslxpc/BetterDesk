import { createSignal } from "solid-js";
import { api, type ConnectionStatus, type RegistrationStatus } from "../lib/tauri";
import { invoke } from "@tauri-apps/api/core";
import { operatorStore } from "./operator";

const EMPTY_STATE: ConnectionStatus = {
  state: "idle",
  peer_id: null,
  peer_info: null,
  latency_ms: null,
  error: null,
};

const EMPTY_REG: RegistrationStatus = {
  registered: false,
  device_id: "",
  server_address: "",
  heartbeat_count: 0,
  last_error: null,
  native_protocol: false,
  signal_connected: null,
  pending_connections: null,
  enrollment_phase: null,
  sync_mode: null,
  branding: null,
  display_name: null,
};

function createConnectionStore() {
  const [state, setState] = createSignal<ConnectionStatus>(EMPTY_STATE);
  const [deviceId, setDeviceId] = createSignal<string>("");
  const [regStatus, setRegStatus] = createSignal<RegistrationStatus>(EMPTY_REG);
  let operatorSession:
    | {
        accessToken: string;
        sessionId: string;
        deviceId: string;
        hostname: string;
        startedAt: number;
        reportedStart: boolean;
      }
    | null = null;

  const createSessionId = () => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `session-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  };

  const isConnectedState = (value: string) =>
    value === "connected" || value === "paired" || value === "active";

  const isTerminalState = (value: string) =>
    value === "disconnected" || value === "idle" || value.startsWith("error");

  const resolveHostname = (status: ConnectionStatus) =>
    status.peer_info?.hostname?.trim() || operatorSession?.hostname || status.peer_id || "";

  const ensureOperatorSessionStarted = async (status: ConnectionStatus) => {
    const accessToken = operatorStore.token;
    const peerId = status.peer_id;
    if (!accessToken || !peerId || !isConnectedState(status.state)) {
      return;
    }

    if (!operatorSession || operatorSession.deviceId !== peerId) {
      operatorSession = {
        accessToken,
        sessionId: createSessionId(),
        deviceId: peerId,
        hostname: resolveHostname(status),
        startedAt: Date.now(),
        reportedStart: false,
      };
    } else if (!operatorSession.hostname && resolveHostname(status)) {
      operatorSession.hostname = resolveHostname(status);
    }

    if (operatorSession.reportedStart) {
      return;
    }

    try {
      await invoke("operator_record_session_event", {
        accessToken: operatorSession.accessToken,
        deviceId: operatorSession.deviceId,
        hostname: operatorSession.hostname,
        action: "session_start",
        sessionId: operatorSession.sessionId,
      });
      operatorSession.reportedStart = true;
    } catch (error) {
      console.warn("Failed to report operator session start:", error);
    }
  };

  const finishOperatorSession = async () => {
    const session = operatorSession;
    operatorSession = null;

    if (!session?.reportedStart) {
      return;
    }

    try {
      await invoke("operator_record_session_event", {
        accessToken: session.accessToken,
        deviceId: session.deviceId,
        hostname: session.hostname,
        action: "session_end",
        sessionId: session.sessionId,
      });
    } catch (error) {
      console.warn("Failed to report operator session end:", error);
    }
  };

  // Load device ID on startup
  (async () => {
    try {
      const id = await api.getDeviceId();
      setDeviceId(id);
    } catch (e) {
      console.error("Failed to get device ID:", e);
    }
  })();

  // Poll registration status every 3 seconds
  let regPollInterval: ReturnType<typeof setInterval> | null = null;
  const startRegPolling = () => {
    if (regPollInterval) return;
    // Immediately fetch once
    api.getRegistrationStatus().then(setRegStatus).catch(() => {});
    regPollInterval = setInterval(async () => {
      try {
        const s = await api.getRegistrationStatus();
        setRegStatus(s);
      } catch {
        // Ignore polling errors
      }
    }, 3000);
  };

  // Start registration polling right away
  startRegPolling();

  // Poll connection state while connecting/connected
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  const startPolling = () => {
    if (pollInterval) return;
    pollInterval = setInterval(async () => {
      try {
        const s = await api.getConnectionState();
        setState(s);

        if (isConnectedState(s.state)) {
          await ensureOperatorSessionStarted(s);
        }

        // Stop polling when disconnected or errored
        if (isTerminalState(s.state)) {
          await finishOperatorSession();
          stopPolling();
        }
      } catch {
        // Ignore polling errors
      }
    }, 500);
  };

  const stopPolling = () => {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  };

  return {
    state,
    deviceId,
    regStatus,

    async startRegistration() {
      try {
        const s = await api.startRegistration();
        setRegStatus(s);
      } catch (e) {
        console.error("Failed to start registration:", e);
      }
    },

    async stopRegistration() {
      try {
        await api.stopRegistration();
        setRegStatus(EMPTY_REG);
      } catch (e) {
        console.error("Failed to stop registration:", e);
      }
    },

    async connect(peerId: string) {
      try {
        if (operatorSession && operatorSession.deviceId !== peerId) {
          await finishOperatorSession();
        }
        setState({ ...EMPTY_STATE, state: "connecting", peer_id: peerId });
        const status = await api.connectToPeer(peerId);
        setState(status);
        await ensureOperatorSessionStarted(status);
        startPolling();
      } catch (e: any) {
        setState({
          ...EMPTY_STATE,
          state: "error",
          peer_id: peerId,
          error: e?.message || String(e),
        });
      }
    },

    async authenticate(password: string) {
      try {
        const status = await api.authenticate(password);
        setState(status);
        await ensureOperatorSessionStarted(status);
      } catch (e: any) {
        setState((prev) => ({
          ...prev,
          state: "error",
          error: e?.message || String(e),
        }));
        throw e;
      }
    },

    async disconnect() {
      await finishOperatorSession();
      try {
        await api.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      stopPolling();
      setState(EMPTY_STATE);
    },

    async sendKey(key: string, down: boolean, modifiers: string[]) {
      try {
        await api.sendKeyEvent({ key, down, modifiers });
      } catch (e) {
        console.error("Failed to send key event:", e);
      }
    },

    async sendMouse(x: number, y: number, mask: number, modifiers: string[]) {
      try {
        await api.sendMouseEvent({ x, y, mask, modifiers });
      } catch (e) {
        console.error("Failed to send mouse event:", e);
      }
    },
  };
}

export const connectionStore = createConnectionStore();
