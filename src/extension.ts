/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Copyright (c) William Welliver. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

"use strict";

import * as vscode from "vscode";
import * as cp from "child_process";
import * as nls from "vscode-nls";

const localize = nls.loadMessageBundle();
let poller;

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("pike.debugger.autoattach")) {
        let val: boolean = vscode.workspace
          .getConfiguration()
          .get("pike.debugger.autoattach");
        if (val) startAutoAttach();
        else stopAutoAttach();
      }
    })
  );

  let val: boolean = vscode.workspace
    .getConfiguration()
    .get("pike.debugger.autoattach");
  if (val) startAutoAttach();
  else stopAutoAttach();
}

export function deactivate() {
  stopAutoAttach();
}

//---- Pike debugger Auto Attach

const POLL_INTERVAL = 1500;

const DEBUG_PORT_PATTERN = /\s--(debugger)-port=(\d+)/;
const DEBUG_FLAGS_PATTERN = /\s--(debugger)?/;
const ochan = vscode.window.createOutputChannel("Pike Auto-attach");
let isStarted = false;

function stopAutoAttach() {
  ochan.appendLine("stopping autoattach");
  if (isStarted) clearInterval(poller);
  poller = null;
  isStarted = false;
}

function startAutoAttach() {
  ochan.appendLine("starting autoattach");
  if (isStarted) return;

  isStarted = true;
  const rootPid = parseInt(process.env["VSCODE_PID"]);

  const defaultLaunchConfig = {
    type: "pike",
    name: "Auto-Attach-Default",
    request: "attach",
    debugServer: 4711,
    timeout: 5000,
  };

  pollChildProcesses(rootPid, (pid, cmd) => {
    if (cmd.indexOf("pike") >= 0) {
      attachChildProcess(pid, cmd, defaultLaunchConfig);
    }
  });
}

/**
 * Poll for all subprocesses of given root process.
 */
function pollChildProcesses(
  rootPid: number,
  processFoundCallback: (pid: number, cmd: string) => void
) {
  poller = setInterval(() => {
    findChildProcesses(rootPid, processFoundCallback);
  }, POLL_INTERVAL);
}

/**
 * Attach debugger to given process.
 */
function attachChildProcess(
  pid: number,
  cmd: string,
  baseConfig: vscode.DebugConfiguration
): boolean {
  const config: vscode.DebugConfiguration = {
    type: "pike",
    request: "attach",
    debugServer: 4711,
    timeout: 5000,
    name: localize("childProcessWithPid", "Process {0}", pid),
  };

  // selectively copy attributes
  if (baseConfig.timeout) {
    config.timeout = baseConfig.timeout;
  }
  if (baseConfig.sourceMaps) {
    config.sourceMaps = baseConfig.sourceMaps;
  }
  if (baseConfig.outFiles) {
    config.outFiles = baseConfig.outFiles;
  }
  if (baseConfig.sourceMapPathOverrides) {
    config.sourceMapPathOverrides = baseConfig.sourceMapPathOverrides;
  }
  if (baseConfig.smartStep) {
    config.smartStep = baseConfig.smartStep;
  }
  if (baseConfig.skipFiles) {
    config.skipFiles = baseConfig.skipFiles;
  }
  if (baseConfig.showAsyncStacks) {
    config.sourceMaps = baseConfig.showAsyncStacks;
  }
  if (baseConfig.trace) {
    config.trace = baseConfig.trace;
  }

  // attach via port

  // a debugger-port=1234 overrides the port
  const matches = DEBUG_PORT_PATTERN.exec(cmd);
  if (matches && matches.length === 3) {
    // override port
    config.debugServer = parseInt(matches[2]);
  }

  // check to see that the debugger port is open and listening before we attempt to attach.
  const CMD =
    "lsof -t -a -n -p " + pid + " -sTCP:LISTEN -iTCP:" + config.debugServer;
  const CMD_PAT = /^\s*([0-9]+)\s+([0-9]+)\s+(.+)$/;

  cp.exec(CMD, { maxBuffer: 1000 * 1024 }, (err, stdout, stderr) => {
    if (!err && !stderr) {
      const lines = stdout.toString().split("\n");
      for (const line of lines) {
        if (line.includes("" + pid)) {
          ochan.appendLine(`attach: ${config.debugServer}`);
          vscode.debug.startDebugging(undefined, config).then((success) => {
            if (success) ochan.appendLine("attach succeeded");
            else ochan.appendLine("attach failed");
          });
          return true;
        }
      }
    }
  });
  return false;
}

/**
 * Find all subprocesses of the given root process
 */
function findChildProcesses(
  rootPid: number,
  processFoundCallback: (pid: number, cmd: string) => void
) {
  const set = new Set<number>();
  if (!isNaN(rootPid) && rootPid > 0) {
    set.add(rootPid);
  }

  function oneProcess(pid: number, ppid: number, cmd: string) {
    if (set.size === 0) {
      // try to find the root process
      const matches = DEBUG_PORT_PATTERN.exec(cmd);
      if (matches && matches.length >= 3) {
        // since this is a child we add the parent id as the root id
        set.add(ppid);
      }
    }

    if (set.has(ppid)) {
      set.add(pid);
      const matches = DEBUG_PORT_PATTERN.exec(cmd);
      const matches2 = DEBUG_FLAGS_PATTERN.exec(cmd);
      if (
        (matches && matches.length >= 3) ||
        (matches2 && matches2.length >= 5)
      ) {
        processFoundCallback(pid, cmd);
      }
    }
  }

  if (process.platform === "win32") {
    const CMD = "wmic process get CommandLine,ParentProcessId,ProcessId";
    const CMD_PAT = /^(.+)\s+([0-9]+)\s+([0-9]+)$/;

    cp.exec(CMD, { maxBuffer: 1000 * 1024 }, (err, stdout, stderr) => {
      if (!err && !stderr) {
        const lines = stdout.split("\r\n");
        for (let line of lines) {
          let matches = CMD_PAT.exec(line.trim());
          if (matches && matches.length === 4) {
            oneProcess(
              parseInt(matches[3]),
              parseInt(matches[2]),
              matches[1].trim()
            );
          }
        }
      }
    });
  } else {
    // OS X & Linux

    // ideally we would be able to skip the 'a' option to save time, but
    // then we wouldn't get any processes started under sudo for example. :/
    const CMD = "ps -ax -o pid=,ppid=,command=";
    const CMD_PAT = /^\s*([0-9]+)\s+([0-9]+)\s+(.+)$/;

    cp.exec(CMD, { maxBuffer: 1000 * 1024 }, (err, stdout, stderr) => {
      if (!err && !stderr) {
        const lines = stdout.toString().split("\n");
        for (const line of lines) {
          let matches = CMD_PAT.exec(line.trim());
          if (matches && matches.length === 4) {
            oneProcess(parseInt(matches[1]), parseInt(matches[2]), matches[3]);
          }
        }
      }
    });
  }
}
