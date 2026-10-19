'use strict';

const vscode = require('vscode');
const cp = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

// Константы и пути

const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';
const REPO = 'can1357/oh-my-pi';
const ASSET = 'omp-windows-x64.exe';
const SUMS = 'SHA256SUMS.txt';
const VERSION_RE = /^\d+\.\d+\.\d+$/;

// Состояние модуля

let output;
let ompRoot = '';
let ready = Promise.resolve();
let count = 0;
const ptys = new Set();
// версия → число вкладок этого окна, которые её выбрали и ещё не завершились
const live = new Map();

// Кавычки: сначала для bash (одинарные кавычки с '\''), затем для PowerShell (удвоенные ')

function bashQuote(s) {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function psQuote(s) {
  return "'" + s.replace(/'/g, "''") + "'";
}

// Окружение дочерних процессов: dir — папка выбранной версии omp

function childEnv(dir) {
  const env = { ...process.env };
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  env[key] = env[key] ? dir + path.delimiter + env[key] : dir;
  // omp's Anthropic transport ignores HTTPS_PROXY and only follows PI_PROXY.
  const envKeys = (name) => Object.keys(env).filter((k) => k.toUpperCase() === name);
  const piKey = envKeys('PI_PROXY')[0] || 'PI_PROXY';
  if (!env[piKey]) {
    const proxy = ['HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'HTTP_PROXY', 'http_proxy']
      .map((name) => envKeys(name.toUpperCase()).map((k) => env[k]).find((v) => v))
      .find((v) => v);
    if (proxy) env[piKey] = proxy;
  }
  return env;
}

// Команды

function activate(context) {
  ompRoot = path.join(context.globalStorageUri.fsPath, 'omp');
  output = vscode.window.createOutputChannel('omp');
  context.subscriptions.push(
    output,
    vscode.commands.registerCommand('omp.newTab', newTab),
  );
  ready = update();
}

// HTTPS-запрос через встроенный модуль Node: прокси VS Code подхватывается самим хостом расширения

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'omp-vscode' };
    if (new URL(url).hostname === 'api.github.com') headers.Accept = 'application/vnd.github+json';
    https.get(url, { headers }, (res) => {
      const code = res.statusCode;
      if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
        res.resume();
        if (redirects >= 5) {
          reject(new Error('слишком много перенаправлений'));
          return;
        }
        resolve(get(new URL(res.headers.location, url).href, redirects + 1));
        return;
      }
      if (code < 200 || code > 299) {
        res.resume();
        reject(new Error('HTTP ' + code));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// Версии установок omp

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function exePath(v) {
  return path.join(ompRoot, v, 'omp.exe');
}

function installedVersions() {
  let names;
  try {
    names = fs.readdirSync(ompRoot);
  } catch {
    return [];
  }
  return names
    .filter((n) => VERSION_RE.test(n) && fs.existsSync(exePath(n)))
    .sort((a, b) => compareVersions(b, a));
}

function latestVersion() {
  const [v] = installedVersions();
  return v ?? null;
}

function rm(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
  } catch {}
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Установка и обновление omp

async function install(version, assets) {
  const tmp = path.join(ompRoot, '.tmp-' + process.pid);
  rm(tmp);
  const find = (name) => {
    const asset = assets.find((a) => a.name === name);
    if (!asset) throw new Error('в релизе нет ' + name);
    return asset.browser_download_url;
  };
  const [exe, sums] = await Promise.all([get(find(ASSET)), get(find(SUMS))]);
  const entry = sums
    .toString('utf8')
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .find((parts) => parts[1] === ASSET);
  if (!entry) throw new Error('в ' + SUMS + ' нет ' + ASSET);
  const hash = crypto.createHash('sha256').update(exe).digest('hex');
  if (hash !== entry[0].toLowerCase()) throw new Error('контрольная сумма ' + ASSET + ' не совпадает');
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'omp.exe'), exe);
  const target = path.join(ompRoot, version);
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      fs.renameSync(tmp, target);
      break;
    } catch (err) {
      // Несколько окон VS Code могут ставить одну версию одновременно: если папка версии уже есть, ошибки нет.
      if (fs.existsSync(exePath(version))) break;
      if (attempt === 5) throw err;
      await sleep(1000);
    }
  }
}

function prune() {
  const versions = installedVersions();
  for (const name of fs.readdirSync(ompRoot)) {
    const p = path.join(ompRoot, name);
    if (name.endsWith('.old')) {
      rm(p);
    } else if (name.startsWith('.') && !name.endsWith('-' + process.pid) && Date.now() - fs.statSync(p).mtimeMs > 3600000) {
      rm(p);
    } else if (VERSION_RE.test(name) && name !== versions[0] && !live.has(name)) {
      // Переименование не проходит, пока запущен omp.exe этой версии: Windows не даёт переименовать занятую папку.
      // Тогда папка остаётся до следующего запуска расширения.
      // Версии, выбранные вкладками этого окна, пропускаются; другие окна VS Code защищены только блокировкой запущенного exe.
      try {
        fs.renameSync(p, p + '.old');
        rm(p + '.old');
      } catch {}
    }
  }
}

async function update() {
  const tmp = path.join(ompRoot, '.tmp-' + process.pid);
  try {
    fs.mkdirSync(ompRoot, { recursive: true });
    const release = JSON.parse((await get('https://api.github.com/repos/' + REPO + '/releases/latest')).toString('utf8'));
    const version = String(release.tag_name ?? '').replace(/^v/, '');
    if (!VERSION_RE.test(version)) throw new Error('неожиданная версия: ' + release.tag_name);
    if (!fs.existsSync(exePath(version))) {
      const job = install(version, release.assets ?? []);
      vscode.window.setStatusBarMessage('omp: устанавливаю ' + version, job);
      await job;
    }
  } catch (err) {
    output.appendLine('обновление omp: ' + err.message);
  } finally {
    rm(tmp);
    try {
      prune();
    } catch (err) {
      output.appendLine('очистка старых версий omp: ' + err.message);
    }
  }
}

// Вкладки терминала

function makePty(nodePty) {
  const writeEmitter = new vscode.EventEmitter();
  let proc = null;
  let closed = false;
  let held = null;

  function hold(v) {
    held = v;
    live.set(v, (live.get(v) || 0) + 1);
  }

  function release() {
    if (held === null) return;
    const n = live.get(held) - 1;
    if (n > 0) live.set(held, n);
    else live.delete(held);
    held = null;
    // версия отпущена: убрать устаревшие версии, если она больше не нужна
    try { prune(); } catch {}
  }

  async function start(dims) {
    let version = latestVersion();
    if (!version) {
      writeEmitter.fire('Устанавливаю omp, это займёт минуту...\r\n');
      await ready;
      if (closed) return;
      version = latestVersion();
      if (!version) {
        writeEmitter.fire('omp не установлен, подробности в выводе «omp» (панель Output)\r\n');
        return;
      }
    }
    hold(version);
    const bashExe = bashQuote(exePath(version).replace(/\\/g, '/'));
    const command = "& '" + GIT_BASH + "' --login -i -c " + psQuote(bashExe);
    const env = childEnv(path.join(ompRoot, version));
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
    let p;
    try {
      p = nodePty.spawn(
        'powershell.exe',
        ['-NoLogo', '-NoProfile', '-Command', command],
        {
          name: 'xterm-256color',
          cols: dims?.columns ?? 120,
          rows: dims?.rows ?? 30,
          cwd,
          env,
        },
      );
    } catch (err) {
      writeEmitter.fire(err.message + '\r\n');
      release();
      return;
    }
    proc = p;
    ptys.add(p);
    p.onData((data) => writeEmitter.fire(data));
    p.onExit(({ exitCode }) => {
      ptys.delete(p);
      release();
      if (proc === p) proc = null;
      writeEmitter.fire('\r\n[omp завершился, код ' + exitCode + ']\r\n');
    });
  }

  return {
    onDidWrite: writeEmitter.event,
    open(dims) {
      start(dims).catch((err) => writeEmitter.fire(err.message + '\r\n'));
    },
    handleInput(data) {
      if (proc) proc.write(data);
    },
    setDimensions(d) {
      if (proc) proc.resize(d.columns, d.rows);
    },
    close() {
      closed = true;
      release();
      if (proc) {
        try {
          proc.kill();
        } catch {}
        ptys.delete(proc);
        proc = null;
      }
    },
  };
}

function loadNodePty() {
  const p = path.join(vscode.env.appRoot, 'node_modules.asar', 'node-pty');
  try {
    return require(p);
  } catch (err) {
    throw new Error('В VS Code не найден node-pty (' + p + '): ' + err.message);
  }
}

function newTab() {
  if (!fs.existsSync(GIT_BASH)) {
    vscode.window.showErrorMessage('Не найден ' + GIT_BASH + '. Установите Git for Windows.');
    return;
  }
  let nodePty;
  try {
    nodePty = loadNodePty();
  } catch (err) {
    vscode.window.showErrorMessage(err.message);
    return;
  }
  const terminal = vscode.window.createTerminal({
    name: 'omp ' + ++count,
    pty: makePty(nodePty),
    location: { viewColumn: vscode.ViewColumn.Active },
  });
  terminal.show();
}

function deactivate() {
  for (const p of [...ptys]) {
    try {
      p.kill();
    } catch {}
  }
}

module.exports = { activate, deactivate };
