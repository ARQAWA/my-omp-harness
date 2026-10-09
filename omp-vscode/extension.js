'use strict';

const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Константы и пути

const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';
const OMP_PACKAGE = '@oh-my-pi/pi-coding-agent';

// Состояние модуля

let output;
let root = '';
let count = 0;
const terminals = new Set();
const ptys = new Set();

function paths() {
  const npmPrefix = path.join(root, 'npm');
  const bunDir = path.join(npmPrefix, 'node_modules', '@oven', 'bun-windows-x64-baseline', 'bin');
  const bunInstall = path.join(root, 'bun');
  const ompDir = path.join(bunInstall, 'bin');
  return {
    root,
    npmPrefix,
    bunDir,
    bun: path.join(bunDir, 'bun.exe'),
    bunInstall,
    ompDir,
    omp: path.join(ompDir, 'omp.exe'),
  };
}

// Окружение дочерних процессов

function childEnv() {
  const p = paths();
  const env = { ...process.env };
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  const prefix = [p.ompDir, p.bunDir].join(path.delimiter);
  env[key] = env[key] ? prefix + path.delimiter + env[key] : prefix;
  env.BUN_INSTALL = p.bunInstall;
  return env;
}

// Команды

function activate(context) {
  root = context.globalStorageUri.fsPath;
  output = vscode.window.createOutputChannel('omp');
  context.subscriptions.push(
    output,
    vscode.commands.registerCommand('omp.prepare', prepare),
    vscode.commands.registerCommand('omp.newTab', newTab),
    vscode.commands.registerCommand('omp.removeAll', removeAll),
    vscode.window.onDidCloseTerminal((t) => terminals.delete(t)),
  );
}

function runStep(line, cmd, args, opts) {
  output.appendLine('> ' + line);
  return new Promise((resolve, reject) => {
    const tail = [];
    const collect = (chunk) => {
      const text = chunk.toString();
      output.append(text);
      for (const raw of text.split(/\r?\n/)) {
        if (raw.trim()) {
          tail.push(raw.trimEnd());
          if (tail.length > 3) tail.shift();
        }
      }
    };
    const fail = (exitInfo) => {
      reject(new Error(line + '\nкод выхода: ' + exitInfo + (tail.length ? '\n' + tail.join('\n') : '')));
    };
    const child = cp.spawn(cmd, args, opts);
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (err) => fail('не получен (' + err.message + ')'));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else fail(String(code));
    });
  });
}

// omp.prepare

async function prepare() {
  output.show(true);
  const p = paths();
  try {
    await fs.promises.mkdir(p.root, { recursive: true });
    const npmLine = 'npm install --prefix "' + p.npmPrefix + '" --no-audit --no-fund @oven/bun-windows-x64-baseline@latest';
    await runStep(npmLine, npmLine, [], { shell: true, cwd: p.root, env: childEnv() });
    const bunLine = '"' + p.bun + '" install -g ' + OMP_PACKAGE;
    await runStep(bunLine, p.bun, ['install', '-g', OMP_PACKAGE], { cwd: p.root, env: childEnv() });
    vscode.window.showInformationMessage('omp установлен. Запуск: OMP: New Tab.');
  } catch (err) {
    vscode.window.showErrorMessage('OMP: Prepare Environment — ошибка: ' + err.message);
  }
}

// omp.newTab

function makePty(nodePty) {
  const writeEmitter = new vscode.EventEmitter();
  let proc = null;
  return {
    onDidWrite: writeEmitter.event,
    open(dims) {
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
      let p;
      try {
        p = nodePty.spawn(
          'powershell.exe',
          ['-NoLogo', '-NoProfile', '-Command', "& '" + GIT_BASH + "' --login -i -c omp"],
          {
            name: 'xterm-256color',
            cols: dims?.columns ?? 120,
            rows: dims?.rows ?? 30,
            cwd,
            env: childEnv(),
          },
        );
      } catch (err) {
        writeEmitter.fire(err.message + '\r\n');
        return;
      }
      proc = p;
      ptys.add(p);
      p.onData((data) => writeEmitter.fire(data));
      p.onExit(({ exitCode }) => {
        ptys.delete(p);
        if (proc === p) proc = null;
        writeEmitter.fire('\r\n[omp завершился, код ' + exitCode + ']\r\n');
      });
    },
    handleInput(data) {
      if (proc) proc.write(data);
    },
    setDimensions(d) {
      if (proc) proc.resize(d.columns, d.rows);
    },
    close() {
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

function newTab() {
  const p = paths();
  if (!fs.existsSync(p.omp)) {
    vscode.window.showErrorMessage('omp не установлен. Сначала выполните OMP: Prepare Environment.');
    return;
  }
  let nodePty;
  try {
    nodePty = require(path.join(vscode.env.appRoot, 'node_modules', 'node-pty'));
  } catch (err) {
    vscode.window.showErrorMessage('В VS Code не найден node-pty: ' + err.message);
    return;
  }
  const terminal = vscode.window.createTerminal({
    name: 'omp ' + ++count,
    pty: makePty(nodePty),
    location: { viewColumn: vscode.ViewColumn.Active },
  });
  terminals.add(terminal);
  terminal.show();
}

// omp.removeAll

async function removeAll() {
  const yes = 'Да';
  const first = await vscode.window.showWarningMessage('Вы уверены, что хотите удалить всё?', { modal: true }, yes);
  if (first !== yes) return;
  const second = await vscode.window.showWarningMessage('Вы точно уверены?', { modal: true }, yes);
  if (second !== yes) return;

  for (const t of [...terminals]) t.dispose();
  terminals.clear();
  for (const p of [...ptys]) {
    try {
      p.kill();
    } catch {}
  }
  ptys.clear();

  try {
    if (fs.existsSync(root)) {
      await fs.promises.rm(root, { recursive: true, maxRetries: 10, retryDelay: 500 });
    }
    vscode.window.showInformationMessage('Bun и omp удалены.');
  } catch (err) {
    vscode.window.showErrorMessage('OMP: Remove All — ошибка: ' + err.message);
  }
}

function deactivate() {
  for (const p of [...ptys]) {
    try {
      p.kill();
    } catch {}
  }
}

module.exports = { activate, deactivate };
