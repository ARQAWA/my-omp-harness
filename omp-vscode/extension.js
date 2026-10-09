'use strict';

const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Константы и пути
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';

// Состояние модуля

let output;
let binDir = '';
let count = 0;
const terminals = new Set();
const ptys = new Set();

function ompExe() {
  return path.join(binDir, 'omp.exe');
}

// Окружение дочерних процессов

function childEnv() {
  const env = { ...process.env };
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  env[key] = env[key] ? binDir + path.delimiter + env[key] : binDir;
  return env;
}

// Команды

function activate(context) {
  binDir = path.join(context.extensionPath, 'bin');
  output = vscode.window.createOutputChannel('omp');
  context.subscriptions.push(
    output,
    vscode.commands.registerCommand('omp.newTab', newTab),
    vscode.window.onDidCloseTerminal((t) => terminals.delete(t)),
  );
  update();
}

// omp update

function update() {
  try {
    const exe = ompExe();
    if (!fs.existsSync(exe)) return;
    output.appendLine('> omp update');
    const child = cp.spawn(exe, ['update'], { cwd: binDir, env: childEnv(), windowsHide: true });
    child.stdout.on('data', (chunk) => output.append(chunk.toString()));
    child.stderr.on('data', (chunk) => output.append(chunk.toString()));
    child.on('close', (code) => output.appendLine('omp update: код выхода ' + code));
    child.on('error', (err) => output.appendLine('omp update: ошибка запуска: ' + err.message));
  } catch (err) {
    output.appendLine('omp update: ошибка запуска: ' + err.message);
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
  if (!fs.existsSync(ompExe())) {
    vscode.window.showErrorMessage('Не найден ' + ompExe() + '. Переустановите расширение.');
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

function deactivate() {
  for (const p of [...ptys]) {
    try {
      p.kill();
    } catch {}
  }
}

module.exports = { activate, deactivate };
