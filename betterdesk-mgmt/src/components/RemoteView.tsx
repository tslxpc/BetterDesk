import { Component, Show, onMount, onCleanup, createSignal, For } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { connectionStore } from "../stores/connection";
import { t } from "../lib/i18n";
import Toolbar from "./Toolbar";

interface FramePayload {
  width: number;
  height: number;
  rgba_b64: string;
}

interface QualityPayload {
  fps: number;
  latency_ms: number;
  bandwidth_kbps: number;
  frames_decoded: number;
  frames_dropped: number;
  codec: string;
  width: number;
  height: number;
}

interface CursorPayload {
  id: number;
  hotx: number;
  hoty: number;
  width: number;
  height: number;
  colors_b64: string;
}

const RemoteView: Component = () => {
  const navigate = useNavigate();
  let canvasRef: HTMLCanvasElement | undefined;
  const [isFullscreen, setIsFullscreen] = createSignal(false);
  const [showToolbar, setShowToolbar] = createSignal(true);
  const [viewerConnected, setViewerConnected] = createSignal(false);
  const [frameCount, setFrameCount] = createSignal(0);
  const [quality, setQuality] = createSignal<QualityPayload | null>(null);
  const [clipboardEnabled, setClipboardEnabled] = createSignal(false);
  const [recording, setRecording] = createSignal(false);
  const [currentDisplay, setCurrentDisplay] = createSignal(0);
  const [useRelaySession, setUseRelaySession] = createSignal(false);

  // Cursor state
  let cursorCache: Map<number, string> = new Map();

  onMount(async () => {
    if (connectionStore.state().state !== "connected") {
      navigate("/");
      return;
    }

    if (canvasRef) {
      setupCanvas(canvasRef);
    }

    const unsubs: (() => void)[] = [];

    // Listen for RGBA frames from relay session (Phase 43)
    unsubs.push(await listen<FramePayload>("remote-frame", (e) => {
      if (!canvasRef) return;
      const { width, height, rgba_b64 } = e.payload;
      setUseRelaySession(true);

      // Resize canvas if needed
      if (canvasRef!.width !== width || canvasRef!.height !== height) {
        canvasRef!.width = width;
        canvasRef!.height = height;
      }

      const ctx = canvasRef!.getContext("2d");
      if (!ctx) return;

      // Decode base64 RGBA → ImageData
      const binary = atob(rgba_b64);
      const bytes = new Uint8ClampedArray(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      if (bytes.length === width * height * 4) {
        const imageData = new ImageData(bytes, width, height);
        ctx.putImageData(imageData, 0, 0);
        setFrameCount((c) => c + 1);
      }
    }));

    // Listen for JPEG frames from management WS viewer (Phase 38 fallback)
    unsubs.push(await listen<string>("remote-viewer-frame", (e) => {
      if (!canvasRef || useRelaySession()) return;
      const img = new Image();
      img.onload = () => {
        const ctx = canvasRef!.getContext("2d");
        if (!ctx) return;
        if (canvasRef!.width !== img.width || canvasRef!.height !== img.height) {
          canvasRef!.width = img.width;
          canvasRef!.height = img.height;
        }
        ctx.drawImage(img, 0, 0);
        setFrameCount((c) => c + 1);
      };
      img.src = "data:image/jpeg;base64," + e.payload;
    }));

    // Listen for cursor updates
    unsubs.push(await listen<CursorPayload>("remote-cursor", (e) => {
      if (!canvasRef) return;
      const c = e.payload;

      // Build cursor image URL and cache it
      if (!cursorCache.has(c.id)) {
        const binary = atob(c.colors_b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        if (bytes.length === c.width * c.height * 4) {
          const cvs = document.createElement("canvas");
          cvs.width = c.width;
          cvs.height = c.height;
          const ctx = cvs.getContext("2d");
          if (ctx) {
            const id = new ImageData(new Uint8ClampedArray(bytes.buffer), c.width, c.height);
            ctx.putImageData(id, 0, 0);
            const url = cvs.toDataURL("image/png");
            cursorCache.set(c.id, `url(${url}) ${c.hotx} ${c.hoty}, auto`);
            // Limit cache size
            if (cursorCache.size > 50) {
              const first = cursorCache.keys().next().value;
              if (first !== undefined) cursorCache.delete(first);
            }
          }
        }
      }

      const cursor = cursorCache.get(c.id);
      if (cursor && canvasRef) {
        canvasRef.style.cursor = cursor;
      }
    }));

    // Listen for quality stats
    unsubs.push(await listen<QualityPayload>("remote-quality", (e) => {
      setQuality(e.payload);
    }));

    // Listen for viewer status (management WS fallback)
    unsubs.push(await listen<any>("remote-viewer-status", (e) => {
      setViewerConnected(e.payload.connected ?? false);
    }));

    // Listen for session close
    unsubs.push(await listen<string>("remote-closed", (e) => {
      console.warn("Remote session closed:", e.payload);
      handleDisconnect();
    }));

    // Listen for display switch
    unsubs.push(await listen<any>("remote-display-switch", (e) => {
      if (canvasRef && e.payload.width && e.payload.height) {
        canvasRef.width = e.payload.width;
        canvasRef.height = e.payload.height;
      }
    }));

    // Start remote session
    const peerId = connectionStore.state().peer_id;
    if (peerId) {
      try {
        // Try relay-based session first (Phase 43)
        await invoke("start_remote_session", { peerId });
      } catch {
        // Fall back to management WS viewer (Phase 38)
        try {
          await invoke("start_remote_viewer", { targetDeviceId: peerId });
        } catch (e) {
          console.error("Failed to start remote viewer:", e);
        }
      }
    }

    onCleanup(() => {
      unsubs.forEach((fn) => fn());
      invoke("stop_remote_session").catch(() => {});
    });
  });

  const setupCanvas = (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const peerInfo = connectionStore.state().peer_info;
    if (peerInfo?.displays?.[0]) {
      canvas.width = peerInfo.displays[0].width || 1920;
      canvas.height = peerInfo.displays[0].height || 1080;
    } else {
      canvas.width = 1920;
      canvas.height = 1080;
    }

    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#e0e0e0";
    ctx.font = "24px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      `Connecting to ${connectionStore.state().peer_id || "unknown"}...`,
      canvas.width / 2,
      canvas.height / 2
    );

    // Mouse move → protobuf via session manager
    canvas.addEventListener("mousemove", (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);
      invoke("send_remote_input", {
        input: { type: "mouse_move", x, y }
      }).catch(() => {});
    });

    canvas.addEventListener("mousedown", (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);
      invoke("send_remote_input", {
        input: { type: "mouse_down", x, y, button: e.button, modifiers: getModifiers(e) }
      }).catch(() => {});
    });

    canvas.addEventListener("mouseup", (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);
      invoke("send_remote_input", {
        input: { type: "mouse_up", x, y, button: e.button, modifiers: getModifiers(e) }
      }).catch(() => {});
    });

    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);
      invoke("send_remote_input", {
        input: { type: "wheel", x, y, delta_x: Math.round(e.deltaX), delta_y: Math.round(e.deltaY) }
      }).catch(() => {});
    }, { passive: false });

    canvas.tabIndex = 0;
    canvas.addEventListener("keydown", (e) => {
      e.preventDefault();
      invoke("send_remote_input", {
        input: { type: "key_down", key: e.key, modifiers: getModifiers(e) }
      }).catch(() => {});
    });

    canvas.addEventListener("keyup", (e) => {
      e.preventDefault();
      invoke("send_remote_input", {
        input: { type: "key_up", key: e.key, modifiers: getModifiers(e) }
      }).catch(() => {});
    });

    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.focus();
  };

  const getModifiers = (e: MouseEvent | KeyboardEvent): string[] => {
    const mods: string[] = [];
    if (e.ctrlKey) mods.push("Control");
    if (e.shiftKey) mods.push("Shift");
    if (e.altKey) mods.push("Alt");
    if (e.metaKey) mods.push("Meta");
    return mods;
  };

  const handleDisconnect = () => {
    invoke("stop_remote_session").catch(() => {});
    connectionStore.disconnect();
    navigate("/");
  };

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
      setIsFullscreen(true);
      invoke("send_remote_input", { input: { type: "refresh_video" } }).catch(() => {});
    } else {
      await document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const handleClipboard = () => {
    const next = !clipboardEnabled();
    setClipboardEnabled(next);
    invoke("toggle_clipboard_sync", { enabled: next }).catch(() => {});
  };

  const handleSpecialKey = (key: string) => {
    invoke("send_special_key", { key }).catch(() => {});
  };

  const handleSwitchDisplay = (index: number) => {
    setCurrentDisplay(index);
    invoke("switch_display", { index }).catch(() => {});
  };

  const handleSetQuality = (preset: string) => {
    const opts: Record<string, { quality: string; fps: number }> = {
      best: { quality: "Best", fps: 60 },
      balanced: { quality: "Balanced", fps: 30 },
      low: { quality: "Low", fps: 15 },
    };
    const opt = opts[preset] || opts.best;
    invoke("set_quality", { imageQuality: opt.quality, fps: opt.fps }).catch(() => {});
  };

  const handleRecording = () => {
    const next = !recording();
    setRecording(next);
    invoke("toggle_recording", { enabled: next }).catch(() => {});
  };

  return (
    <div
      class="remote-view"
      onMouseMove={() => setShowToolbar(true)}
    >
      <Show when={showToolbar()}>
        <Toolbar
          peerId={connectionStore.state().peer_id || ""}
          latency={quality()?.latency_ms ?? connectionStore.state().latency_ms}
          isFullscreen={isFullscreen()}
          onDisconnect={handleDisconnect}
          onFullscreen={toggleFullscreen}
          quality={quality()}
          clipboardEnabled={clipboardEnabled()}
          recording={recording()}
          onClipboard={handleClipboard}
          onSpecialKey={handleSpecialKey}
          onSwitchDisplay={handleSwitchDisplay}
          onSetQuality={handleSetQuality}
          onRecording={handleRecording}
        />
      </Show>

      <div class="canvas-container">
        <canvas
          ref={canvasRef}
          class="remote-canvas"
        />
      </div>

      {/* Quality overlay */}
      <Show when={quality()}>
        <div class="quality-overlay">
          <span>{quality()!.fps.toFixed(0)} FPS</span>
          <span>{quality()!.codec.toUpperCase()}</span>
          <Show when={quality()!.latency_ms > 0}>
            <span>{quality()!.latency_ms}ms</span>
          </Show>
          <Show when={quality()!.bandwidth_kbps > 0}>
            <span>{(quality()!.bandwidth_kbps / 1000).toFixed(1)} Mbps</span>
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default RemoteView;
