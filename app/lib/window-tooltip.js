'use strict';

// A click-through companion window keeps Mini's help outside its fixed HUD.
// It has no preload, recording access, navigation or focus and shares the
// recorder's screen-capture privacy preference.
const TOOLTIP_DOCUMENT = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>html,body{margin:0;padding:0;overflow:hidden;background:#f8f8fa;color:#242529}
body{font:12px/17px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
#hint{display:inline-block;box-sizing:border-box;max-width:100%;padding:7px 10px;
border:1px solid #d3d4da;border-radius:6px;overflow-wrap:anywhere}
body[data-theme="dark"],html:has(body[data-theme="dark"]){background:#303136;color:#f4f4f6}
body[data-theme="dark"] #hint{border-color:#55565f}</style></head>
<body><div id="hint" role="tooltip"></div></body></html>`;

function tooltipBounds({ parent, windowBounds = parent, anchor, size, workArea, compact = false, placement = 'top', zoom = 1 }) {
  const edge = 8;
  const gap = 7;
  const width = Math.min(Math.max(40, Math.ceil(size.width)), Math.max(40, workArea.width - edge * 2));
  const height = Math.min(Math.max(24, Math.ceil(size.height)), Math.max(24, workArea.height - edge * 2));
  const a = { x: parent.x + anchor.x * zoom, y: parent.y + anchor.y * zoom,
    width: anchor.width * zoom, height: anchor.height * zoom };
  const above = (compact ? windowBounds.y : a.y) - height - gap;
  const below = (compact ? windowBounds.y + windowBounds.height : a.y + a.height) + gap;
  const fits = y => y >= workArea.y + edge && y + height <= workArea.y + workArea.height - edge;
  const preferred = placement === 'bottom' ? below : above;
  const alternate = placement === 'bottom' ? above : below;
  // Never cover Mini when it is close to the top or bottom of a display.
  if (compact && !fits(preferred) && !fits(alternate)) return null;
  const y = fits(preferred) ? preferred : fits(alternate) ? alternate :
    Math.max(workArea.y + edge, Math.min(preferred, workArea.y + workArea.height - height - edge));
  const x = Math.max(workArea.x + edge, Math.min(a.x + (a.width - width) / 2,
    workArea.x + workArea.width - width - edge));
  return { x: Math.round(x), y: Math.round(y), width, height };
}

class WindowTooltip {
  constructor({ BrowserWindow, screen, getParent, getMode, getPrivacy }) {
    Object.assign(this, { BrowserWindow, screen, getParent, getMode, getPrivacy });
    this.window = null;
    this.ready = null;
    this.request = 0;
  }

  refreshPrivacy() {
    if (!this.window || this.window.isDestroyed()) return;
    try { this.window.setContentProtection(Boolean(this.getPrivacy())); } catch {}
  }

  hide() {
    this.request += 1;
    if (this.window && !this.window.isDestroyed()) this.window.hide();
  }

  dispose() {
    this.hide();
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
    this.ready = null;
  }

  async show(payload = {}) {
    const parent = this.getParent();
    const anchor = payload.anchor;
    const text = String(payload.text || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    if (!parent || parent.isDestroyed() || !parent.isVisible() || parent.isMinimized() || !text ||
        !anchor || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(anchor[key])) ||
        anchor.width <= 0 || anchor.height <= 0) return { shown: false };
    const request = ++this.request;
    try {
      const content = parent.getContentBounds();
      const zoom = parent.webContents.getZoomFactor();
      if (anchor.x < -1 || anchor.y < -1 || anchor.x * zoom > content.width || anchor.y * zoom > content.height) return { shown: false };
      const area = this.screen.getDisplayMatching(parent.getBounds()).workArea;
      const maxWidth = Math.min(320, Math.max(40, area.width - 16));
      if (!this.window || this.window.isDestroyed()) {
        const hint = new this.BrowserWindow({
          parent, width: maxWidth, height: 100, frame: false, show: false,
          focusable: false, skipTaskbar: true, resizable: false, movable: false,
          minimizable: false, maximizable: false, fullscreenable: false,
          hasShadow: true, title: 'PulseStudio Hint', backgroundColor: '#f8f8fa',
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
        });
        this.window = hint;
        hint.setIgnoreMouseEvents(true, { forward: true });
        hint.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        hint.webContents.on('will-navigate', event => event.preventDefault());
        hint.once('closed', () => {
          if (this.window === hint) { this.window = null; this.ready = null; }
        });
        this.refreshPrivacy();
        this.ready = hint.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(TOOLTIP_DOCUMENT));
      }
      const hint = this.window;
      await this.ready;
      if (request !== this.request || hint.isDestroyed() || parent.isDestroyed()) return { shown: false };
      hint.setSize(maxWidth, 100, false);
      const theme = payload.theme === 'dark' ? 'dark' : 'light';
      const size = await hint.webContents.executeJavaScript(`(() => {
        document.body.dataset.theme = ${JSON.stringify(theme)};
        const hint = document.getElementById('hint');
        hint.textContent = ${JSON.stringify(text)};
        const bounds = hint.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      })()`);
      if (request !== this.request || hint.isDestroyed() || parent.isDestroyed() || !parent.isVisible() || parent.isMinimized()) return { shown: false };
      const bounds = tooltipBounds({ parent: content, windowBounds: parent.getBounds(), anchor, size, workArea: area,
        compact: this.getMode() === 'compact', placement: payload.placement, zoom });
      if (!bounds) { this.hide(); return { shown: false }; }
      this.refreshPrivacy();
      hint.setBackgroundColor(theme === 'dark' ? '#303136' : '#f8f8fa');
      hint.setAlwaysOnTop(parent.isAlwaysOnTop(), parent.isAlwaysOnTop() ? 'floating' : 'normal');
      hint.setBounds(bounds, false);
      hint.showInactive();
      return { shown: true };
    } catch {
      this.hide();
      return { shown: false };
    }
  }
}

module.exports = { WindowTooltip, tooltipBounds };
