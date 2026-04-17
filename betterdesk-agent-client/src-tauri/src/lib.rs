//! BetterDesk Agent Client — lightweight endpoint device agent.
//!
//! Architecture:
//! - `config`          — Persistent settings (server address, device identity, preferences)
//! - `registration`    — Multi-step server validation and device registration flow
//! - `sysinfo_collect` — System information collection (hostname, OS, CPU, RAM, disk)
//! - `commands`        — Tauri IPC commands exposed to the frontend

pub mod commands;
pub mod config;
pub mod privileges;
pub mod registration;
pub mod sysinfo_collect;

use log::info;
use std::sync::Mutex;
use tauri::Manager;

/// Entry point — called from main.rs.
pub fn run() {
    let is_console = std::env::args().any(|a| a == "--console");
    let default_level = if is_console { "debug" } else { "info" };

    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or(default_level))
        .format_timestamp_millis()
        .init();

    info!(
        "BetterDesk Agent v{} (pid={}) — boot",
        env!("CARGO_PKG_VERSION"),
        std::process::id()
    );

    let settings = config::AgentConfig::load().unwrap_or_default();
    let is_registered = settings.is_registered();

    info!(
        "Config loaded — registered: {}, server: {:?}",
        is_registered,
        settings.server_address
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            info!("Second instance detected — bringing existing window to front");
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(commands::AgentState {
            config: Mutex::new(settings),
            chat_history: Mutex::new(Vec::new()),
        })
        .invoke_handler(tauri::generate_handler![
            // Status & lifecycle
            commands::is_os_admin,
            commands::get_agent_status,
            commands::reconnect_agent,
            commands::send_diagnostics,
            commands::get_agent_version,
            commands::copy_to_clipboard,
            // Registration flow
            commands::validate_server_step,
            commands::register_device,
            commands::sync_initial_config,
            // Chat
            commands::get_chat_history,
            commands::send_chat_message,
            // Help request
            commands::request_help,
            commands::cancel_help_request,
            // Settings
            commands::get_agent_settings,
            commands::save_agent_settings,
            commands::test_server_connection,
            commands::restart_agent_service,
            commands::unregister_device,
        ])
        .setup(move |app| {
            info!("Tauri setup complete");

            // Tray icon — always visible, minimal.
            setup_tray(app.handle())?;

            // Hide main window on startup if autostart mode.
            if std::env::args().any(|a| a == "--autostart") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Minimize to tray on close instead of exiting.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("Failed to start BetterDesk Agent");
}

/// System tray setup.
///
/// Menu layout:
/// - User items (always visible):    Show ID, Help request, Chat, Check connection
/// - Admin-gated items (OS admin):   Settings, Quit agent
///
/// Admin detection is cached at setup time. If privilege status changes
/// (user elevates mid-session), restart the agent.
fn setup_tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
    use tauri::tray::TrayIconBuilder;

    let is_admin = privileges::is_os_admin();
    info!("Tray setup — OS admin: {}", is_admin);

    // Always-visible (user) items.
    let show_id = MenuItemBuilder::with_id("show_id", "Show device ID").build(app)?;
    let help = MenuItemBuilder::with_id("help_request", "Request help").build(app)?;
    let chat = MenuItemBuilder::with_id("chat", "Chat").build(app)?;
    let check = MenuItemBuilder::with_id("check_conn", "Check connection").build(app)?;

    let mut builder = MenuBuilder::new(app)
        .item(&show_id)
        .item(&help)
        .item(&chat)
        .item(&check);

    // Admin-only items.
    if is_admin {
        let sep = PredefinedMenuItem::separator(app)?;
        let settings = MenuItemBuilder::with_id("settings", "Settings").build(app)?;
        let quit = MenuItemBuilder::with_id("quit", "Quit agent").build(app)?;
        builder = builder.item(&sep).item(&settings).item(&quit);
    }

    let menu = builder.build()?;

    let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip(if is_admin {
            "BetterDesk Agent (admin)"
        } else {
            "BetterDesk Agent"
        })
        .on_menu_event(move |app, event| {
            let id = event.id().as_ref();
            match id {
                "show_id" => show_window(app, "/"),
                "help_request" => show_window(app, "/help"),
                "chat" => show_window(app, "/chat"),
                "check_conn" => show_window(app, "/?action=reconnect"),
                // Admin-gated. Re-check privilege before executing to guard
                // against tampered menu IDs (double-safety).
                "settings" => {
                    if privileges::is_os_admin() {
                        show_window(app, "/settings");
                    } else {
                        info!("Settings requested but not admin — ignoring");
                    }
                }
                "quit" => {
                    if privileges::is_os_admin() {
                        info!("Quit requested from tray (admin confirmed)");
                        app.exit(0);
                    } else {
                        info!("Quit requested but not admin — ignoring");
                    }
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                show_window(tray.app_handle(), "/");
            }
        })
        .build(app)?;

    Ok(())
}

/// Bring the main window to front and navigate to a given route.
///
/// The route is emitted as a `navigate` event; the SolidJS router listens
/// and performs client-side navigation. Falls back to showing the window
/// even if navigation fails (e.g. frontend not ready).
fn show_window(app: &tauri::AppHandle, route: &str) {
    use tauri::Emitter;

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = app.emit("navigate", route.to_string());
    }
}
