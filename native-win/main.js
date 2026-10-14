// Windows-приложение Точка: окно, которое открывает сайт на GitHub Pages.
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

const APP_URL = 'https://cunbent-present.github.io/tochka/';

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 380,
    backgroundColor: '#1B2126',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true }
  });

  win.loadURL(APP_URL);

  // Ссылки на другие сайты (Яндекс-маршрут, соцсети) открываем в обычном браузере
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(APP_URL)) { e.preventDefault(); shell.openExternal(url); }
  });

  // Нет интернета — показываем понятную страницу вместо пустого окна
  win.webContents.on('did-fail-load', (_e, code, _desc, url) => {
    if (code !== -3 && url.startsWith(APP_URL)) win.loadFile(path.join(__dirname, 'offline.html'));
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
