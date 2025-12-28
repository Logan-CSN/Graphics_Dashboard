// main.js - Electron main process
const { app, BrowserWindow, ipcMain, globalShortcut } = require('electron');
const path = require('path');

// Enable logging and disable hardware acceleration for headless environment
process.env.ELECTRON_ENABLE_LOGGING = 'true';
app.commandLine.appendSwitch('enable-logging');
app.commandLine.appendSwitch('disable-gpu');
app.disableHardwareAcceleration();

// Detect headless environment
const isHeadless = !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
console.log('Environment check - Headless:', isHeadless);

let controlWin;   // index.html (control panel)
let graphicsWin;  // Graphics_output.html (OBS/browser source)

function createWindows() {
  console.log('Creating windows...');
  // Graphics Output
  graphicsWin = new BrowserWindow({
    transparent: true,       // ✅ allow transparency
    frame: false,            // ✅ hide window frame
    alwaysOnTop: false,      // ✅ useful for OBS
    backgroundColor: '#00000000', // ✅ fully transparent
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  graphicsWin.maximize();
  // graphicsWin.setBounds({ x: -9999, y: -9999 });

  // Forward graphics renderer console to main process logs
  graphicsWin.webContents.on('console-message', (_, level, message, line, source) => {
    console.log(`[graphics:${level}] ${message} (${source}:${line})`);
  });

  graphicsWin.loadFile(path.join(__dirname, 'Graphics_output.html'));

  // Control Panel
  controlWin = new BrowserWindow({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  controlWin.maximize();
  controlWin.setMenu(null);

  // Forward renderer console to main process logs
  controlWin.webContents.on('console-message', (_, level, message, line, source) => {
    console.log(`[renderer:${level}] ${message} (${source}:${line})`);
  });

  controlWin.loadFile(path.join(__dirname, 'index.html'));
}

// Global hotkeys storage
let registeredHotkeys = {};

// Register a global hotkey
function registerGlobalHotkey(accelerator, action) {
  try {
    // Unregister existing hotkey if it exists
    if (registeredHotkeys[accelerator]) {
      globalShortcut.unregister(accelerator);
    }

    // Always try to register global shortcuts first, even in headless environments
    const success = globalShortcut.register(accelerator, () => {
      console.log(`Global hotkey triggered: ${accelerator} -> ${action}`);
      // Send hotkey action to control window
      if (controlWin && !controlWin.isDestroyed()) {
        controlWin.webContents.send('global-hotkey-triggered', action);
      }
    });

    if (success) {
      registeredHotkeys[accelerator] = action;
      console.log(`Global hotkey registered successfully: ${accelerator} -> ${action}`);
    } else {
      console.warn(`Failed to register global hotkey: ${accelerator} - trying alternative approach`);
      // If global registration fails, still track it and try alternative methods
      registeredHotkeys[accelerator] = action;

      // Notify renderer to use in-window hotkeys as fallback
      if (controlWin && !controlWin.isDestroyed()) {
        controlWin.webContents.send('hotkey-mode', { mode: 'in-window', accelerator, action });
      }
    }
  } catch (error) {
    console.error(`Error registering hotkey ${accelerator}:`, error);
    // Still track it for fallback handling
    registeredHotkeys[accelerator] = action;
  }
}

// Unregister a global hotkey
function unregisterGlobalHotkey(accelerator) {
  if (registeredHotkeys[accelerator]) {
    globalShortcut.unregister(accelerator);
    delete registeredHotkeys[accelerator];
    console.log(`Global hotkey unregistered: ${accelerator}`);
  }
}

// Convert readable hotkey format to Electron accelerator format
function convertToElectronAccelerator(hotkeyString) {
  if (!hotkeyString) return null;

  // Convert common key names to Electron format
  return hotkeyString
    .replace(/Ctrl/g, 'CommandOrControl')
    .replace(/Meta/g, 'Super')
    .replace(/ \+ /g, '+')
    .replace(/\s+/g, '');
}

// Handle hotkey registration from renderer
ipcMain.on('register-hotkey', (event, { accelerator, action }) => {
  const electronAccelerator = convertToElectronAccelerator(accelerator);
  if (electronAccelerator) {
    registerGlobalHotkey(electronAccelerator, action);
  }
});

// Handle hotkey unregistration from renderer
ipcMain.on('unregister-hotkey', (event, accelerator) => {
  const electronAccelerator = convertToElectronAccelerator(accelerator);
  if (electronAccelerator) {
    unregisterGlobalHotkey(electronAccelerator);
  }
});

// Handle bulk hotkey registration from renderer
ipcMain.on('register-all-hotkeys', (event, hotkeys) => {
  console.log('Received register-all-hotkeys request:', hotkeys);
  // Clear existing hotkeys
  Object.keys(registeredHotkeys).forEach(accelerator => {
    globalShortcut.unregister(accelerator);
  });
  registeredHotkeys = {};

  // Register new hotkeys
  Object.keys(hotkeys).forEach(action => {
    const hotkeyString = hotkeys[action];
    if (!hotkeyString) return; // Skip empty hotkeys

    const electronAccelerator = convertToElectronAccelerator(hotkeyString);
    console.log(`Converting hotkey: ${hotkeyString} -> ${electronAccelerator} for action: ${action}`);
    if (electronAccelerator) {
      registerGlobalHotkey(electronAccelerator, action);
    } else {
      console.warn(`Failed to convert hotkey: ${hotkeyString} for action: ${action}`);
    }
  });

  console.log(`Total global hotkeys registered: ${Object.keys(registeredHotkeys).length}`);
});

// Relay messages from control panel -> graphics window
ipcMain.on('graphic-command', (event, command) => {
  if (graphicsWin && !graphicsWin.isDestroyed()) {
    graphicsWin.webContents.send('graphic-command', command);
  }
});

app.whenReady().then(() => {
  createWindows();

  // Set up additional global shortcut handling after windows are created
  setTimeout(() => {
    console.log('Setting up enhanced global shortcut handling...');
    // Force re-registration of any existing hotkeys after app is fully ready
    const currentHotkeys = { ...registeredHotkeys };
    registeredHotkeys = {};
    Object.keys(currentHotkeys).forEach(accelerator => {
      registerGlobalHotkey(accelerator, currentHotkeys[accelerator]);
    });
  }, 1000);
});

app.on('window-all-closed', () => {
  // Unregister all global shortcuts
  globalShortcut.unregisterAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  // Unregister all global shortcuts
  globalShortcut.unregisterAll();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindows();
});

// Handle focus events to ensure hotkeys work regardless of window focus
app.on('browser-window-focus', () => {
  console.log('Window focused - ensuring hotkeys are active');
});

app.on('browser-window-blur', () => {
  console.log('Window blurred - global hotkeys should still work');
});