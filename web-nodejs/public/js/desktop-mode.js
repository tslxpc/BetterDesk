/**
 * BetterDesk Console - Desktop Mode (BETA)
 * Windows-like desktop environment with floating windows, taskbar, and app icons.
 * Available on viewports >= 1200px.
 * 
 * Status: BETA - Experimental feature, under active development.
 * Known limitations: iframe-based routing, mobile not supported, performance with many windows.
 */

(function() {
    'use strict';

    // ============ Constants ============

    const MIN_WIDTH = 420;
    const MIN_HEIGHT = 300;
    const TASKBAR_HEIGHT = 48;
    const BREAKPOINT = 1200;
    const STORAGE_KEY = 'betterdesk_desktop_mode';
    const STORAGE_WINS_KEY = 'betterdesk_desktop_wins';
    const CASCADE_OFFSET = 32;
    const STORAGE_FOLDABLE_AUTO = 'betterdesk_foldable_auto'; // Auto-switch on unfold

    // ============ State ============

    let active = false;
    let windows = new Map();
    let zCounter = 100;
    let focusedWindowId = null;
    let cascadeIndex = 0;
    let dragState = null;
    let resizeState = null;

    // Widget mode: 'windows' or 'widgets'
    let currentMode = 'widgets'; // Default to widgets mode
    const STORAGE_MODE = 'betterdesk_desktop_view_mode';

    // Foldable phone detection
    let isFoldableDevice = false;
    let devicePosture = 'unknown'; // 'continuous', 'folded', 'folded-over'

    // ============ Window Bounds Persistence ============

    /**
     * Save window position + size for a given app so it can be restored
     * when the user reopens the same app in a later session.
     */
    function saveWindowBounds(appId, x, y, width, height) {
        try {
            var all = JSON.parse(localStorage.getItem(STORAGE_WINS_KEY) || '{}');
            all[appId] = { x: x, y: y, w: width, h: height };
            localStorage.setItem(STORAGE_WINS_KEY, JSON.stringify(all));
        } catch (_) { /* quota exceeded — ignore */ }
    }

    function loadWindowBounds(appId) {
        try {
            var all = JSON.parse(localStorage.getItem(STORAGE_WINS_KEY) || '{}');
            return all[appId] || null;
        } catch (_) { return null; }
    }

    // ============ Apps Definition ============

    function getApps() {
        var t = typeof _ === 'function' ? _ : function(k) { return k; };
        var isAdmin = window.BetterDesk && window.BetterDesk.user &&
                      window.BetterDesk.user.role === 'admin';
        var apps = [
            { id: 'dashboard',     icon: 'dashboard',   route: '/',              color: '#58a6ff',  name: t('nav.dashboard') },
            { id: 'devices',       icon: 'devices',     route: '/devices',       color: '#3fb950',  name: t('nav.devices') },
            { id: 'registrations', icon: 'how_to_reg',  route: '/registrations', color: '#79c0ff',  name: t('nav.registrations') },
            { id: 'keys',          icon: 'vpn_key',     route: '/keys',          color: '#d29922',  name: t('nav.keys') },
            { id: 'generator',     icon: 'build',       route: '/generator',     color: '#bc8cff',  name: t('nav.generator') },
            { id: 'settings',      icon: 'settings',    route: '/settings',      color: '#8b949e',  name: t('nav.settings') }
        ];

        if (isAdmin) {
            apps.splice(5, 0, {
                id: 'users', icon: 'group', route: '/users', color: '#f778ba', name: t('nav.users')
            });
        }

        return apps;
    }

    // ============ Initialization ============

    function init() {
        if (window.BetterDesk && window.BetterDesk.embed) return;
        
        // Initialize foldable device detection
        initFoldableDetection();
        
        if (window.innerWidth < BREAKPOINT && !isFoldableDevice) return;

        setupGlobalListeners();

        if (localStorage.getItem(STORAGE_KEY) === 'true' && window.innerWidth >= BREAKPOINT) {
            activate(true);
        }
    }

    // ============ Foldable Phone Detection ============

    function initFoldableDetection() {
        // Method 1: Device Posture API (Chrome 125+)
        if ('devicePosture' in navigator) {
            isFoldableDevice = true;
            devicePosture = navigator.devicePosture.type || 'unknown';
            
            navigator.devicePosture.addEventListener('change', function() {
                devicePosture = navigator.devicePosture.type;
                handlePostureChange(devicePosture);
            });
        }
        
        // Method 2: Screen Fold API (experimental)
        if ('getScreenFold' in window) {
            isFoldableDevice = true;
            window.getScreenFold().then(function(fold) {
                if (fold) {
                    fold.addEventListener('change', function() {
                        handleFoldChange(fold.angle, fold.posture);
                    });
                }
            }).catch(function() {});
        }
        
        // Method 3: CSS screen-spanning media query detection
        if (window.matchMedia) {
            var foldQuery = window.matchMedia('(screen-spanning: single-fold-vertical)');
            if (foldQuery.matches || foldQuery.media !== 'not all') {
                // Device supports screen-spanning query = likely foldable
                isFoldableDevice = checkFoldableByMediaQuery();
            }
            foldQuery.addEventListener('change', function(e) {
                if (e.matches) {
                    isFoldableDevice = true;
                    handlePostureChange('continuous');
                }
            });
        }
        
        // Method 4: Viewport size heuristic for known foldable aspect ratios
        // Samsung Galaxy Z Fold: ~880px unfolded inner width
        // Vivo X Fold: ~1080px unfolded inner width
        if (!isFoldableDevice) {
            isFoldableDevice = detectFoldableByAspectRatio();
        }
        
        // Log foldable detection status
        if (isFoldableDevice) {
            console.log('BetterDesk: Foldable device detected, posture:', devicePosture);
        }
    }
    
    function checkFoldableByMediaQuery() {
        return window.matchMedia('(horizontal-viewport-segments: 2)').matches ||
               window.matchMedia('(vertical-viewport-segments: 2)').matches ||
               window.matchMedia('(screen-spanning: single-fold-horizontal)').matches ||
               window.matchMedia('(screen-spanning: single-fold-vertical)').matches;
    }
    
    function detectFoldableByAspectRatio() {
        var w = window.innerWidth;
        var h = window.innerHeight;
        var ratio = w / h;
        
        // Foldable phones when unfolded typically have wider aspect ratios
        // Samsung Z Fold unfolded: ~1.0-1.2 (almost square)
        // Most regular phones: 0.4-0.6 (portrait) or 1.6-2.0 (landscape)
        
        // Consider device foldable if:
        // - Has touch support (mobile device)
        // - Inner width >= 700px (large for a phone)
        // - Aspect ratio between 0.8 and 1.4 (nearly square)
        var hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        var isLargeForPhone = w >= 700 && w <= 1400;
        var nearlySquare = ratio >= 0.8 && ratio <= 1.4;
        
        return hasTouch && isLargeForPhone && nearlySquare;
    }
    
    function handlePostureChange(posture) {
        devicePosture = posture;
        var autoSwitchEnabled = localStorage.getItem(STORAGE_FOLDABLE_AUTO) !== 'false';
        
        if (posture === 'continuous') {
            // Device is unfolded / flat
            if (autoSwitchEnabled && window.innerWidth >= BREAKPOINT) {
                activate(true);
            }
        } else if (posture === 'folded' || posture === 'folded-over') {
            // Device is folded
            if (autoSwitchEnabled && active) {
                deactivate(true);
            }
        }
    }
    
    function handleFoldChange(angle, posture) {
        // angle > 160° = nearly flat (unfolded)
        // angle < 90° = folded
        if (angle > 160) {
            handlePostureChange('continuous');
        } else if (angle < 90) {
            handlePostureChange('folded');
        }
    }
    
    function setFoldableAutoSwitch(enabled) {
        localStorage.setItem(STORAGE_FOLDABLE_AUTO, enabled ? 'true' : 'false');
    }
    
    function isFoldableAutoSwitchEnabled() {
        return localStorage.getItem(STORAGE_FOLDABLE_AUTO) !== 'false';
    }

    function setupGlobalListeners() {
        // Navbar toggle button
        var btn = document.getElementById('desktop-toggle-btn');
        if (btn) {
            btn.addEventListener('click', function() { toggle(); });
        }

        // Desktop context menu (right-click on desktop background)
        var shell = document.getElementById('desktop-shell');
        if (shell) {
            shell.addEventListener('contextmenu', function(e) {
                // Only trigger on desktop background, not on windows/widgets
                if (e.target.closest('.desktop-window') || e.target.closest('.desktop-taskbar') ||
                    e.target.closest('.desktop-widget') || e.target.closest('.desktop-icon')) return;
                e.preventDefault();
                showContextMenu(e.clientX, e.clientY);
            });
        }

        // Global mouse events for drag/resize
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        // Responsive: deactivate if viewport shrinks below breakpoint
        // and re-clamp windows that may be offscreen after resize
        var onResize = Utils.debounce(function() {
            if (active && window.innerWidth < BREAKPOINT) {
                deactivate(true);
                return;
            }
            if (active) clampAllWindows();
        }, 200);
        window.addEventListener('resize', onResize);
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', onResize);
        }
    }

    // ============ Activate / Deactivate ============

    function activate(skipAnimation) {
        if (active) return;
        active = true;
        localStorage.setItem(STORAGE_KEY, 'true');

        document.body.classList.add('desktop-active');
        if (!skipAnimation) {
            document.body.classList.add('desktop-entering');
            setTimeout(function() {
                document.body.classList.remove('desktop-entering');
            }, 350);
        }

        renderDesktopIcons();

        // Restore saved mode or default to widgets
        currentMode = localStorage.getItem(STORAGE_MODE) || 'widgets';
        applyMode(currentMode);
    }

    function deactivate(silent) {
        if (!active) return;
        active = false;
        localStorage.setItem(STORAGE_KEY, 'false');

        // Destroy widget mode
        if (window.DesktopWidgets) {
            window.DesktopWidgets.destroy();
            window.DesktopWidgets.removeAddButton();
        }

        // Close all windows
        windows.forEach(function(win) {
            removeWindowDOM(win.id, true);
        });
        windows.clear();
        focusedWindowId = null;
        cascadeIndex = 0;

        document.body.classList.remove('desktop-active', 'desktop-entering', 'desktop-mode-widgets', 'desktop-mode-windows');
        clearDesktopIcons();
        clearTaskbar();

        if (!silent) {
            // Reload to restore console view properly
            window.location.reload();
        }
    }

    function toggle() {
        if (active) {
            deactivate();
        } else {
            activate();
        }
    }

    // ============ Desktop Icons ============

    function renderDesktopIcons() {
        var container = document.getElementById('desktop-icons');
        if (!container) return;
        container.innerHTML = '';

        var apps = getApps();
        apps.forEach(function(app, index) {
            var el = document.createElement('div');
            el.className = 'desktop-icon';
            el.setAttribute('data-app', app.id);
            el.style.animationDelay = (index * 0.05) + 's';

            el.innerHTML =
                '<div class="desktop-icon-img" style="background:' + app.color + '">' +
                    '<span class="material-icons">' + app.icon + '</span>' +
                '</div>' +
                '<span class="desktop-icon-label">' + escapeHtml(app.name) + '</span>';

            el.addEventListener('dblclick', function() {
                openApp(app);
            });

            container.appendChild(el);
        });
    }

    function clearDesktopIcons() {
        var container = document.getElementById('desktop-icons');
        if (container) container.innerHTML = '';
    }

    // ============ Desktop Context Menu ============

    function showContextMenu(x, y) {
        var menu = document.getElementById('desktop-context-menu');
        if (!menu) return;

        // Position menu, ensuring it stays within viewport
        var area = getDesktopArea();
        var mw = 200, mh = 160; // approximate menu size
        var posX = Math.min(x, area.width - mw);
        var posY = Math.min(y, area.y + area.height - mh);

        menu.style.left = posX + 'px';
        menu.style.top = posY + 'px';
        menu.style.display = 'block';

        function closeCtx(e) {
            if (!menu.contains(e.target)) {
                menu.style.display = 'none';
                document.removeEventListener('click', closeCtx);
            }
        }
        setTimeout(function() {
            document.addEventListener('click', closeCtx);
        }, 10);

        // Context menu actions
        menu.querySelectorAll('.ctx-item').forEach(function(item) {
            item.onclick = function() {
                menu.style.display = 'none';
                var action = item.getAttribute('data-action');
                if (action === 'wallpaper' && window.DesktopWidgets) {
                    window.DesktopWidgets.openWallpaperPicker();
                } else if (action === 'refresh') {
                    if (window.DesktopWidgets) window.DesktopWidgets.refreshAll();
                } else if (action === 'exit') {
                    deactivate();
                }
            };
        });
    }

    // ============ Taskbar Auto-Hide ============

    function updateTaskbarVisibility() {
        var taskbar = document.getElementById('desktop-taskbar');
        if (!taskbar) return;

        // Show taskbar only in windows mode or when there are open windows
        if (currentMode === 'widgets' && windows.size === 0) {
            taskbar.classList.add('taskbar-hidden');
        } else {
            taskbar.classList.remove('taskbar-hidden');
        }
    }

    // ============ Window Management ============

    function openApp(app) {
        // Check if window already open for this app
        var existingId = null;
        windows.forEach(function(win, id) {
            if (win.appId === app.id) existingId = id;
        });

        if (existingId) {
            var win = windows.get(existingId);
            if (win.minimized) {
                restoreWindow(existingId);
            }
            focusWindow(existingId);
            return;
        }

        createWindow(app);
    }

    function createWindow(app) {
        var id = 'win-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);

        // Try to restore saved position + size for this app
        var saved = loadWindowBounds(app.id);
        var area = getDesktopArea();
        var width, height, x, y;

        if (saved && saved.w > 0 && saved.h > 0) {
            width  = Math.min(saved.w, area.width);
            height = Math.min(saved.h, area.height);
            x = Math.max(area.x, Math.min(saved.x, area.x + area.width - 80));
            y = Math.max(area.y, Math.min(saved.y, area.y + area.height - 32));
        } else {
            // Default cascading position
            width  = Math.min(960, area.width - 80);
            height = Math.min(640, area.height - 80);
            x = area.x + 60 + (cascadeIndex * CASCADE_OFFSET) % (area.width - width - 60);
            y = area.y + 40 + (cascadeIndex * CASCADE_OFFSET) % (area.height - height - 40);
        }
        cascadeIndex++;

        var win = {
            id: id,
            appId: app.id,
            app: app,
            x: x,
            y: y,
            width: width,
            height: height,
            minimized: false,
            maximized: false,
            prevBounds: null,
            zIndex: ++zCounter
        };

        windows.set(id, win);
        renderWindow(win);
        focusWindow(id);
        updateTaskbar();
    }

    function renderWindow(win) {
        var container = document.getElementById('desktop-windows');
        if (!container) return;

        var el = document.createElement('div');
        el.className = 'desktop-window focused';
        el.id = win.id;
        el.style.left = win.x + 'px';
        el.style.top = win.y + 'px';
        el.style.width = win.width + 'px';
        el.style.height = win.height + 'px';
        el.style.zIndex = win.zIndex;

        var t = typeof _ === 'function' ? _ : function(k) { return k; };

        el.innerHTML =
            '<div class="window-titlebar" data-win="' + win.id + '">' +
                '<div class="window-titlebar-icon" style="background:' + win.app.color + '">' +
                    '<span class="material-icons">' + win.app.icon + '</span>' +
                '</div>' +
                '<div class="window-titlebar-text">' + escapeHtml(win.app.name) + '</div>' +
                '<div class="window-titlebar-controls">' +
                    '<button class="window-ctrl-btn minimize-btn" data-action="minimize" title="' + escapeAttr(t('desktop.minimize')) + '">' +
                        '<span class="material-icons">minimize</span>' +
                    '</button>' +
                    '<button class="window-ctrl-btn maximize-btn" data-action="maximize" title="' + escapeAttr(t('desktop.maximize')) + '">' +
                        '<span class="material-icons">crop_square</span>' +
                    '</button>' +
                    '<button class="window-ctrl-btn close-btn" data-action="close" title="' + escapeAttr(t('desktop.close')) + '">' +
                        '<span class="material-icons">close</span>' +
                    '</button>' +
                '</div>' +
            '</div>' +
            '<div class="window-content">' +
                '<div class="window-loading">' +
                    '<div class="window-loading-spinner"></div>' +
                    '<div class="window-loading-text">' + escapeHtml(t('desktop.loading')) + '</div>' +
                '</div>' +
                '<iframe src="' + escapeAttr(win.app.route + '?embed=1') + '" ' +
                    'sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals" ' +
                    'loading="lazy"></iframe>' +
            '</div>' +
            '<div class="window-edge edge-n" data-dir="n"></div>' +
            '<div class="window-edge edge-s" data-dir="s"></div>' +
            '<div class="window-edge edge-e" data-dir="e"></div>' +
            '<div class="window-edge edge-w" data-dir="w"></div>' +
            '<div class="window-edge edge-ne" data-dir="ne"></div>' +
            '<div class="window-edge edge-nw" data-dir="nw"></div>' +
            '<div class="window-edge edge-se" data-dir="se"></div>' +
            '<div class="window-edge edge-sw" data-dir="sw"></div>';

        // Event: focus on click
        el.addEventListener('mousedown', function(e) {
            if (!e.target.closest('.window-ctrl-btn')) {
                focusWindow(win.id);
            }
        });

        // Event: title bar controls
        el.querySelectorAll('.window-ctrl-btn').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var action = btn.getAttribute('data-action');
                if (action === 'minimize') minimizeWindow(win.id);
                else if (action === 'maximize') toggleMaximize(win.id);
                else if (action === 'close') closeWindow(win.id);
            });
        });

        // Event: drag via title bar
        var titlebar = el.querySelector('.window-titlebar');
        titlebar.addEventListener('mousedown', function(e) {
            if (e.target.closest('.window-ctrl-btn')) return;
            startDrag(win.id, e);
        });

        // Event: double-click title bar to maximize
        titlebar.addEventListener('dblclick', function(e) {
            if (e.target.closest('.window-ctrl-btn')) return;
            toggleMaximize(win.id);
        });

        // Event: resize edges/corners
        el.querySelectorAll('.window-edge').forEach(function(edge) {
            edge.addEventListener('mousedown', function(e) {
                e.stopPropagation();
                startResize(win.id, e, edge.getAttribute('data-dir'));
            });
        });

        // Event: iframe loaded
        var iframe = el.querySelector('iframe');
        var loadingOverlay = el.querySelector('.window-loading');
        iframe.addEventListener('load', function() {
            loadingOverlay.classList.add('hidden');
        });

        container.appendChild(el);
    }

    function closeWindow(id) {
        var win = windows.get(id);
        // Persist position before removing
        if (win && !win.maximized) {
            saveWindowBounds(win.appId, win.x, win.y, win.width, win.height);
        }

        var el = document.getElementById(id);
        if (!el) {
            windows.delete(id);
            updateTaskbar();
            return;
        }

        el.classList.add('closing');
        el.addEventListener('animationend', function() {
            removeWindowDOM(id, false);
        }, { once: true });
    }

    function removeWindowDOM(id, immediate) {
        var el = document.getElementById(id);
        if (el) {
            // Destroy iframe to free memory
            var iframe = el.querySelector('iframe');
            if (iframe) iframe.src = 'about:blank';
            el.remove();
        }
        windows.delete(id);

        if (focusedWindowId === id) {
            focusedWindowId = null;
            // Focus next topmost window
            var topWin = null;
            windows.forEach(function(w) {
                if (!w.minimized && (!topWin || w.zIndex > topWin.zIndex)) {
                    topWin = w;
                }
            });
            if (topWin) focusWindow(topWin.id);
        }

        updateTaskbar();
    }

    function minimizeWindow(id) {
        var win = windows.get(id);
        if (!win) return;
        win.minimized = true;

        var el = document.getElementById(id);
        if (el) {
            el.classList.add('minimizing');
            el.addEventListener('animationend', function() {
                el.style.display = 'none';
                el.classList.remove('minimizing');
            }, { once: true });
        }

        if (focusedWindowId === id) {
            focusedWindowId = null;
            // Focus next topmost visible window
            var topWin = null;
            windows.forEach(function(w) {
                if (!w.minimized && w.id !== id && (!topWin || w.zIndex > topWin.zIndex)) {
                    topWin = w;
                }
            });
            if (topWin) focusWindow(topWin.id);
        }

        updateTaskbar();
    }

    function restoreWindow(id) {
        var win = windows.get(id);
        if (!win) return;
        win.minimized = false;

        var el = document.getElementById(id);
        if (el) {
            el.style.display = '';
            el.style.animation = 'none';
            // Force reflow
            el.offsetHeight;
            el.style.animation = '';
            el.classList.remove('minimizing');
            // Re-trigger open animation
            el.style.animation = 'windowOpen 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) forwards';
        }

        focusWindow(id);
        updateTaskbar();
    }

    function toggleMaximize(id) {
        var win = windows.get(id);
        if (!win) return;

        var el = document.getElementById(id);
        if (!el) return;

        if (win.maximized) {
            // Restore
            win.maximized = false;
            el.classList.remove('maximized');
            if (win.prevBounds) {
                el.style.left = win.prevBounds.x + 'px';
                el.style.top = win.prevBounds.y + 'px';
                el.style.width = win.prevBounds.width + 'px';
                el.style.height = win.prevBounds.height + 'px';
                win.x = win.prevBounds.x;
                win.y = win.prevBounds.y;
                win.width = win.prevBounds.width;
                win.height = win.prevBounds.height;
            }
        } else {
            // Maximize
            win.prevBounds = { x: win.x, y: win.y, width: win.width, height: win.height };
            win.maximized = true;
            var area = getDesktopArea();
            el.classList.add('maximized');
            el.style.left = area.x + 'px';
            el.style.top = area.y + 'px';
            el.style.width = area.width + 'px';
            el.style.height = area.height + 'px';
            win.x = area.x;
            win.y = area.y;
            win.width = area.width;
            win.height = area.height;
        }

        // Update maximize button icon
        var maxBtn = el.querySelector('.maximize-btn .material-icons');
        if (maxBtn) {
            maxBtn.textContent = win.maximized ? 'filter_none' : 'crop_square';
        }
    }

    function focusWindow(id) {
        if (focusedWindowId === id) return;

        // Unfocus previous
        if (focusedWindowId) {
            var prevEl = document.getElementById(focusedWindowId);
            if (prevEl) prevEl.classList.remove('focused');
        }

        focusedWindowId = id;
        var win = windows.get(id);
        if (!win) return;

        win.zIndex = ++zCounter;
        var el = document.getElementById(id);
        if (el) {
            el.style.zIndex = win.zIndex;
            el.classList.add('focused');
            // Disable pointer events on iframe when not focused for drag/resize
        }

        updateTaskbar();
    }

    // ============ Drag ============

    function startDrag(winId, e) {
        var win = windows.get(winId);
        if (!win || win.maximized) return;

        e.preventDefault();
        focusWindow(winId);

        dragState = {
            winId: winId,
            startX: e.clientX,
            startY: e.clientY,
            origX: win.x,
            origY: win.y
        };

        disableIframePointerEvents();
        document.body.style.cursor = 'move';
    }

    function handleMouseMove(e) {
        if (dragState) {
            var dx = e.clientX - dragState.startX;
            var dy = e.clientY - dragState.startY;
            var win = windows.get(dragState.winId);
            if (!win) return;

            var area = getDesktopArea();
            var newX = dragState.origX + dx;
            var newY = dragState.origY + dy;

            // Clamp: keep at least 80px of title bar visible horizontally
            newX = Math.max(-win.width + 80, Math.min(newX, area.width - 80));
            // Clamp: stay within desktop area (above taskbar, below topnav)
            newY = Math.max(area.y, Math.min(newY, area.y + area.height - 32));

            win.x = newX;
            win.y = newY;

            var el = document.getElementById(dragState.winId);
            if (el) {
                el.style.left = win.x + 'px';
                el.style.top = win.y + 'px';
            }
        }

        if (resizeState) {
            var dx = e.clientX - resizeState.startX;
            var dy = e.clientY - resizeState.startY;
            var win = windows.get(resizeState.winId);
            if (!win) return;

            var dir = resizeState.dir;
            var newX = win.x, newY = win.y;
            var newW = win.width, newH = win.height;
            var area = getDesktopArea();

            if (dir.indexOf('e') !== -1) {
                newW = Math.max(MIN_WIDTH, Math.min(resizeState.origW + dx, area.width - newX));
            }
            if (dir.indexOf('w') !== -1) {
                var dw = resizeState.origW - dx;
                if (dw >= MIN_WIDTH) {
                    newW = dw;
                    newX = Math.max(0, resizeState.origX + dx);
                }
            }
            if (dir.indexOf('s') !== -1) {
                newH = Math.max(MIN_HEIGHT, Math.min(resizeState.origH + dy, area.y + area.height - newY));
            }
            if (dir === 'n' || dir === 'ne' || dir === 'nw') {
                var dh = resizeState.origH - dy;
                if (dh >= MIN_HEIGHT) {
                    newH = dh;
                    newY = Math.max(0, resizeState.origY + dy);
                }
            }

            win.x = newX;
            win.y = newY;
            win.width = newW;
            win.height = newH;

            var el = document.getElementById(resizeState.winId);
            if (el) {
                el.style.left = newX + 'px';
                el.style.top = newY + 'px';
                el.style.width = newW + 'px';
                el.style.height = newH + 'px';
            }
        }
    }

    function handleMouseUp() {
        if (dragState) {
            var win = windows.get(dragState.winId);
            if (win && !win.maximized) {
                saveWindowBounds(win.appId, win.x, win.y, win.width, win.height);
            }
        }
        if (resizeState) {
            var win = windows.get(resizeState.winId);
            if (win && !win.maximized) {
                saveWindowBounds(win.appId, win.x, win.y, win.width, win.height);
            }
        }
        if (dragState || resizeState) {
            enableIframePointerEvents();
            document.body.style.cursor = '';
        }
        dragState = null;
        resizeState = null;
    }

    /**
     * Re-clamp all windows within viewport bounds (e.g. after browser resize).
     */
    function clampAllWindows() {
        var area = getDesktopArea();
        windows.forEach(function(win) {
            var el = document.getElementById(win.id);
            if (!el) return;

            if (win.maximized) {
                // Re-maximize to new area bounds
                win.x = area.x;
                win.y = area.y;
                win.width = area.width;
                win.height = area.height;
                el.style.left = area.x + 'px';
                el.style.top = area.y + 'px';
                el.style.width = area.width + 'px';
                el.style.height = area.height + 'px';
                return;
            }

            // Keep at least 80px visible horizontally, stay within area vertically
            var clampedX = Math.max(-win.width + 80, Math.min(win.x, area.width - 80));
            var clampedY = Math.max(area.y, Math.min(win.y, area.y + area.height - 32));
            if (clampedX !== win.x || clampedY !== win.y) {
                win.x = clampedX;
                win.y = clampedY;
                el.style.left = win.x + 'px';
                el.style.top = win.y + 'px';
            }

            // Shrink window if it exceeds available area
            if (win.width > area.width) {
                win.width = area.width;
                el.style.width = win.width + 'px';
            }
            if (win.y + win.height > area.y + area.height) {
                win.height = Math.max(MIN_HEIGHT, area.y + area.height - win.y);
                el.style.height = win.height + 'px';
            }
        });
    }

    // ============ Resize ============

    var cursorMap = { n:'ns-resize', s:'ns-resize', e:'ew-resize', w:'ew-resize',
                       ne:'nesw-resize', sw:'nesw-resize', nw:'nwse-resize', se:'nwse-resize' };

    function startResize(winId, e, dir) {
        var win = windows.get(winId);
        if (!win || win.maximized) return;

        e.preventDefault();
        focusWindow(winId);

        resizeState = {
            winId: winId,
            dir: dir || 'se',
            startX: e.clientX,
            startY: e.clientY,
            origW: win.width,
            origH: win.height,
            origX: win.x,
            origY: win.y
        };

        disableIframePointerEvents();
        document.body.style.cursor = cursorMap[dir] || 'se-resize';
    }

    // ============ Iframe Pointer Control ============

    function disableIframePointerEvents() {
        document.querySelectorAll('.desktop-window iframe').forEach(function(iframe) {
            iframe.style.pointerEvents = 'none';
        });
    }

    function enableIframePointerEvents() {
        document.querySelectorAll('.desktop-window iframe').forEach(function(iframe) {
            iframe.style.pointerEvents = '';
        });
    }

    // ============ Taskbar ============

    function updateTaskbar() {
        var container = document.getElementById('taskbar-apps');
        if (!container) return;
        container.innerHTML = '';

        windows.forEach(function(win) {
            var btn = document.createElement('button');
            btn.className = 'taskbar-app-btn';
            if (!win.minimized) btn.classList.add('active');
            if (win.id === focusedWindowId) btn.classList.add('focused');

            btn.innerHTML =
                '<span class="material-icons" style="color:' + win.app.color + '">' +
                    win.app.icon +
                '</span>' +
                '<span>' + escapeHtml(win.app.name) + '</span>';

            btn.addEventListener('click', function() {
                if (win.minimized) {
                    restoreWindow(win.id);
                } else if (win.id === focusedWindowId) {
                    minimizeWindow(win.id);
                } else {
                    focusWindow(win.id);
                }
            });

            container.appendChild(btn);
        });

        updateTaskbarVisibility();
    }

    function clearTaskbar() {
        var container = document.getElementById('taskbar-apps');
        if (container) container.innerHTML = '';
    }

    // ============ Helpers ============

    function getDesktopArea() {
        // Use visualViewport for accurate available space (excludes on-screen keyboards,
        // browser chrome, etc.). Falls back to window.innerWidth/Height.
        var vp = window.visualViewport;
        var vpWidth = vp ? vp.width : window.innerWidth;
        var vpHeight = vp ? vp.height : window.innerHeight;

        // In widgets mode, taskbar is hidden — full height minus topnav (42px)
        var bottomOffset = (currentMode === 'widgets') ? 0 : TASKBAR_HEIGHT;

        // Respect CSS safe-area-inset-bottom (accounts for system UI overlap)
        var safeBottom = 0;
        try {
            var cs = getComputedStyle(document.documentElement);
            safeBottom = parseInt(cs.getPropertyValue('--desktop-safe-bottom'), 10) || 0;
        } catch (e) { /* ignore */ }

        return {
            x: 0,
            y: 42,
            width: vpWidth,
            height: vpHeight - 42 - bottomOffset - safeBottom
        };
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    function escapeAttr(str) {
        return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')
                          .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ============ Mode Switching (Windows ↔ Widgets) ============

    function switchMode(mode) {
        if (mode === currentMode) return;
        currentMode = mode;
        localStorage.setItem(STORAGE_MODE, mode);
        applyMode(mode);
    }

    function applyMode(mode) {
        // Unified mode: widgets always visible, windows layer on top
        document.body.classList.remove('desktop-mode-widgets', 'desktop-mode-windows');
        document.body.classList.add('desktop-mode-unified');

        // Always show windows container (for float windows)
        var winsContainer = document.getElementById('desktop-windows');
        if (winsContainer) winsContainer.style.display = '';

        // Hide desktop icons in unified mode (apps open as windows)
        var iconsContainer = document.getElementById('desktop-icons');
        if (iconsContainer) iconsContainer.style.display = 'none';

        // Always initialize widgets
        if (window.DesktopWidgets) {
            window.DesktopWidgets.init();
            window.DesktopWidgets.renderAddButton();
        }
    }

    // ============ Open App By Route ============

    // Extra route → app mappings for pages not in getApps()
    function _getExtraRoutes() {
        return {
            '/audit':        { id: 'audit',      icon: 'monitoring',          color: '#f0883e', name: t('nav.activity') },
            '/network':      { id: 'network',    icon: 'wifi',                color: '#56d364', name: t('nav.network') },
            '/cdap/devices': { id: 'cdap',       icon: 'developer_board',     color: '#79c0ff', name: t('nav.cdap') },
            '/tokens':       { id: 'tokens',     icon: 'token',               color: '#d2a8ff', name: t('nav.tokens') },
            '/inventory':    { id: 'inventory',   icon: 'inventory_2',         color: '#f78166', name: t('nav.inventory') },
            '/tickets':      { id: 'tickets',     icon: 'confirmation_number', color: '#d2a8ff', name: t('nav.tickets') },
            '/automation':   { id: 'automation',  icon: 'auto_fix_high',       color: '#56d364', name: t('nav.automation') },
            '/reports':      { id: 'reports',     icon: 'assessment',          color: '#79c0ff', name: t('nav.reports') },
            '/dataguard':    { id: 'dataguard',   icon: 'shield',              color: '#f0883e', name: t('nav.dataguard') },
            '/tenants':      { id: 'tenants',     icon: 'business',            color: '#d2a8ff', name: t('nav.tenants') },
            '/activity':     { id: 'activity',    icon: 'timeline',            color: '#f0883e', name: t('nav.activity') }
        };
    }

    function openAppByRoute(route) {
        if (!active) return;
        if (!route) return;

        // Unified mode: open apps directly as float windows (no mode switching)

        // Find matching app in getApps()
        var apps = getApps();
        var found = null;
        for (var i = 0; i < apps.length; i++) {
            if (apps[i].route === route) { found = apps[i]; break; }
        }

        // Check extra routes
        var extraRoutes = _getExtraRoutes();
        if (!found && extraRoutes[route]) {
            found = Object.assign({ route: route }, extraRoutes[route]);
        }

        // Fallback: create ad-hoc app entry
        if (!found) {
            var label = route.replace(/^\//, '').replace(/\//g, ' > ') || 'Page';
            found = { id: 'page-' + route.replace(/\W/g, '_'), icon: 'open_in_new', route: route, color: '#8b949e', name: label };
        }

        openApp(found);
    }

    // ============ Public API ============

    window.DesktopMode = {
        init: init,
        toggle: toggle,
        isActive: function() { return active; },
        activate: activate,
        deactivate: deactivate,
        switchMode: switchMode,
        getMode: function() { return currentMode; },
        openAppByRoute: openAppByRoute,
        // Foldable device API
        isFoldable: function() { return isFoldableDevice; },
        getDevicePosture: function() { return devicePosture; },
        setFoldableAutoSwitch: setFoldableAutoSwitch,
        isFoldableAutoSwitchEnabled: isFoldableAutoSwitchEnabled
    };

})();
