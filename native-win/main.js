// Windows-приложение Точка: окно, которое открывает сайт Точки (tochka-klient.ru, он на GitHub Pages).
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

const APP_URL = 'https://tochka-klient.ru/';
// старый адрес перекидывает на новый — оба считаем «своими», остальное открываем в браузере
const OWN = [APP_URL, 'https://www.tochka-klient.ru/', 'https://cunbent-present.github.io/tochka/'];
const isOwn = url => OWN.some(u => url.startsWith(u));

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 380,
    backgroundColor: '#F2F4F7',
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
    if (!isOwn(url)) { e.preventDefault(); shell.openExternal(url); }
  });

  // Нет интернета — показываем понятную страницу вместо пустого окна
  win.webContents.on('did-fail-load', (_e, code, _desc, url) => {
    if (code !== -3 && isOwn(url)) win.loadFile(path.join(__dirname, 'offline.html'));
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
