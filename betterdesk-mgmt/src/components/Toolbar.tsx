import { Component, Show, createSignal } from "solid-js";
import { t } from "../lib/i18n";

interface QualityInfo {
  fps: number;
  latency_ms: number;
  bandwidth_kbps: number;
  frames_decoded: number;
  frames_dropped: number;
  codec: string;
  width: number;
  height: number;
}

interface ToolbarProps {
  peerId: string;
  latency?: number | null;
  isFullscreen: boolean;
  onDisconnect: () => void;
  onFullscreen: () => void;
  quality?: QualityInfo | null;
  clipboardEnabled?: boolean;
  recording?: boolean;
  onClipboard?: () => void;
  onSpecialKey?: (key: string) => void;
  onSwitchDisplay?: (index: number) => void;
  onSetQuality?: (preset: string) => void;
  onRecording?: () => void;
}

const Toolbar: Component<ToolbarProps> = (props) => {
  const [showSpecialKeys, setShowSpecialKeys] = createSignal(false);
  const [showQualityMenu, setShowQualityMenu] = createSignal(false);

  const handleSpecialKey = (key: string) => {
    props.onSpecialKey?.(key);
    setShowSpecialKeys(false);
  };

  const handleQualityPreset = (preset: string) => {
    props.onSetQuality?.(preset);
    setShowQualityMenu(false);
  };

  return (
    <div class="toolbar">
      <div class="toolbar-left">
        <span class="toolbar-peer">
          <span class="status-dot connected" />
          {props.peerId}
        </span>
        <Show when={props.latency != null && (props.latency ?? 0) > 0}>
          <span class="toolbar-latency">{props.latency}ms</span>
        </Show>
        <Show when={props.quality}>
          <span class="toolbar-codec">{props.quality!.codec.toUpperCase()}</span>
          <span class="toolbar-fps">{props.quality!.fps.toFixed(0)} FPS</span>
          <span class="toolbar-resolution">{props.quality!.width}×{props.quality!.height}</span>
        </Show>
      </div>

      <div class="toolbar-center">
        {/* Special keys menu */}
        <div class="toolbar-dropdown-wrapper">
          <button
            class="toolbar-btn"
            title={t('remote.special_keys')}
            onClick={() => setShowSpecialKeys(!showSpecialKeys())}
          >
            <span class="mi mi-sm">keyboard</span>
          </button>
          <Show when={showSpecialKeys()}>
            <div class="toolbar-dropdown">
              <button class="toolbar-dropdown-item" onClick={() => handleSpecialKey("CtrlAltDel")}>
                {t('remote.ctrl_alt_del')}
              </button>
              <button class="toolbar-dropdown-item" onClick={() => handleSpecialKey("LockScreen")}>
                {t('remote.lock_screen') || "Lock Screen"}
              </button>
            </div>
          </Show>
        </div>

        {/* Clipboard sync */}
        <button
          class={`toolbar-btn ${props.clipboardEnabled ? "active" : ""}`}
          title={t('toolbar.clipboard')}
          onClick={() => props.onClipboard?.()}
        >
          <span class="mi mi-sm">content_paste</span>
        </button>

        {/* File transfer (placeholder — opens file transfer panel) */}
        <button class="toolbar-btn" title={t('toolbar.file_transfer')} disabled>
          <span class="mi mi-sm">file_download</span>
        </button>

        {/* Quality preset */}
        <div class="toolbar-dropdown-wrapper">
          <button
            class="toolbar-btn"
            title={t('remote.quality')}
            onClick={() => setShowQualityMenu(!showQualityMenu())}
          >
            <span class="mi mi-sm">tune</span>
          </button>
          <Show when={showQualityMenu()}>
            <div class="toolbar-dropdown">
              <button class="toolbar-dropdown-item" onClick={() => handleQualityPreset("best")}>
                Best (60 FPS)
              </button>
              <button class="toolbar-dropdown-item" onClick={() => handleQualityPreset("balanced")}>
                Balanced (30 FPS)
              </button>
              <button class="toolbar-dropdown-item" onClick={() => handleQualityPreset("low")}>
                Low (15 FPS)
              </button>
            </div>
          </Show>
        </div>

        {/* Monitor selector */}
        <button
          class="toolbar-btn"
          title={t('remote.monitor')}
          onClick={() => props.onSwitchDisplay?.(props.quality?.width ? 1 : 0)}
        >
          <span class="mi mi-sm">monitor</span>
        </button>

        {/* Recording toggle */}
        <button
          class={`toolbar-btn ${props.recording ? "recording" : ""}`}
          title={t('remote.recording') || "Record Session"}
          onClick={() => props.onRecording?.()}
        >
          <span class="mi mi-sm">{props.recording ? "stop_circle" : "fiber_manual_record"}</span>
        </button>
      </div>

      <div class="toolbar-right">
        <button
          class="toolbar-btn"
          title={props.isFullscreen ? t('toolbar.exit_fullscreen') : t('toolbar.fullscreen')}
          onClick={props.onFullscreen}
        >
          <span class="mi mi-sm">{props.isFullscreen ? "fullscreen_exit" : "fullscreen"}</span>
        </button>
        <button
          class="toolbar-btn disconnect"
          title={t('remote.disconnect')}
          onClick={props.onDisconnect}
        >
          <span class="mi mi-sm">close</span>
          <span>{t('remote.disconnect')}</span>
        </button>
      </div>
    </div>
  );
};

export default Toolbar;
