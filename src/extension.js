const vscode = require("vscode");
const cp = require("child_process");
const path = require("path");
const fs = require("fs");

const DESIGN_FILE = "martin-studio.design.json";
const EXTENSION_CONFIG_KEY = "martinStudio";

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("martinStudio.openStudio", async () => {
      await openStudio(context, null);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("martinStudio.openCurrentFile", async (uri) => {
      let sourceContext = null;
      if (uri && uri.fsPath) {
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });
        const workspaceFolder = getWorkspaceFolder();
        if (workspaceFolder && uri.fsPath.startsWith(workspaceFolder.uri.fsPath)) {
          sourceContext = {
            path: uri.fsPath,
            relativePath: path.relative(workspaceFolder.uri.fsPath, uri.fsPath),
          };
        }
      }
      await openStudio(context, sourceContext);
    })
  );
}

function deactivate() {}

async function openStudio(context, preferredSourceContext) {
  const workspaceFolder = getWorkspaceFolder();
  if (!workspaceFolder) {
    vscode.window.showErrorMessage("Open a MARTIN workspace first.");
    return;
  }
  const sourceContext = preferredSourceContext || getActiveSourceContext(workspaceFolder);

  const panel = vscode.window.createWebviewPanel(
    "martinStudio",
    "MARTIN Studio",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
    }
  );

  panel.webview.html = getWebviewHtml(panel.webview, context.extensionUri);

  panel.webview.onDidReceiveMessage(async (message) => {
    try {
      if (message.type === "ready") {
        const design = await loadStudioDocument(workspaceFolder, sourceContext);
        const catalog = await loadCatalog(workspaceFolder);
        const previewHtml = sourceContext && sourceContext.path
          ? await renderSourcePreviewHtml(workspaceFolder, sourceContext.path)
          : "";
        panel.webview.postMessage({
          type: "bootstrap",
          payload: {
            design,
            catalog,
            sourceContext,
            previewHtml,
            designPath: path.join(workspaceFolder.uri.fsPath, DESIGN_FILE),
          },
        });
        return;
      }

      if (message.type === "saveDesign") {
        await saveDesignDocument(workspaceFolder, message.payload.design);
        if (message.payload.sourceCode && sourceContext && sourceContext.path) {
          await saveSourceFile(sourceContext.path, message.payload.sourceCode);
          vscode.window.setStatusBarMessage(`MARTIN Studio saved to ${sourceContext.relativePath}`, 3000);
        } else {
          vscode.window.setStatusBarMessage("MARTIN Studio design saved", 2000);
        }
        const refreshedPreviewHtml = sourceContext && sourceContext.path
          ? await renderSourcePreviewHtml(workspaceFolder, sourceContext.path)
          : "";
        panel.webview.postMessage({
          type: "saveComplete",
          payload: {
            target: sourceContext && sourceContext.relativePath ? sourceContext.relativePath : DESIGN_FILE,
            previewHtml: refreshedPreviewHtml,
          },
        });
        return;
      }

      if (message.type === "reloadCatalog") {
        const catalog = await loadCatalog(workspaceFolder);
        panel.webview.postMessage({
          type: "catalogReloaded",
          payload: catalog,
        });
        vscode.window.setStatusBarMessage("MARTIN widget catalog reloaded", 2000);
        return;
      }

      if (message.type === "openDesignSource") {
        const uri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, DESIGN_FILE));
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });
      }
    } catch (error) {
      const text = error && error.message ? error.message : String(error);
      vscode.window.showErrorMessage(`MARTIN Studio: ${text}`);
    }
  });
}

function getWorkspaceFolder() {
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  return folder || null;
}

function defaultDesign() {
  return {
    version: 1,
    title: "MARTIN Studio Design",
    root: {
      id: "node_root",
      type: "Column",
      props: {
        gap: 16,
        padding: 24,
      },
      children: [
        {
          id: "node_heading",
          type: "Heading",
          props: {
            content: "Welcome to MARTIN Studio",
            level: 1,
          },
          children: [],
        },
        {
          id: "node_text",
          type: "Paragraph",
          props: {
            content: "Drag widgets from the palette, edit properties on the right and use the generated code as your MARTIN starting point.",
          },
          children: [],
        },
        {
          id: "node_button",
          type: "Button",
          props: {
            label: "Get started",
            variant: "primary",
          },
          children: [],
        },
      ],
    },
  };
}

async function ensureDesignDocument(workspaceFolder) {
  const filePath = path.join(workspaceFolder.uri.fsPath, DESIGN_FILE);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultDesign(), null, 2), "utf8");
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function loadStudioDocument(workspaceFolder, sourceContext) {
  if (sourceContext && sourceContext.path) {
    try {
      return await parseSourceFileToDesign(workspaceFolder, sourceContext.path);
    } catch (_error) {
    }
  }
  return ensureDesignDocument(workspaceFolder);
}

function getActiveSourceContext(workspaceFolder) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return null;
  }
  const filePath = editor.document.uri.fsPath;
  if (!filePath.endsWith(".py")) {
    return null;
  }
  if (!filePath.startsWith(workspaceFolder.uri.fsPath)) {
    return null;
  }
  return {
    path: filePath,
    relativePath: path.relative(workspaceFolder.uri.fsPath, filePath),
  };
}

async function saveDesignDocument(workspaceFolder, design) {
  const filePath = path.join(workspaceFolder.uri.fsPath, DESIGN_FILE);
  fs.writeFileSync(filePath, JSON.stringify(design, null, 2), "utf8");
}

async function saveSourceFile(filePath, sourceCode) {
  const uri = vscode.Uri.file(filePath);
  const doc = await vscode.workspace.openTextDocument(uri);
  const edit = new vscode.WorkspaceEdit();
  const fullRange = new vscode.Range(
    doc.positionAt(0),
    doc.positionAt(doc.getText().length)
  );
  edit.replace(uri, fullRange, sourceCode);
  await vscode.workspace.applyEdit(edit);
  await doc.save();
}

async function parseSourceFileToDesign(workspaceFolder, sourcePath) {
  const frameworkPath = resolveFrameworkPath(workspaceFolder);
  const configuredPython = getConfig("pythonPath");
  const command = [
    "import json, sys",
    "sys.stdout.reconfigure(encoding='utf-8')",
    "from martin.studio import parse_source_file_to_design",
    `print(json.dumps(parse_source_file_to_design(r'''${escapePython(sourcePath)}'''), ensure_ascii=False))`,
  ].join("; ");
  const attempts = buildPythonAttempts(configuredPython, command);
  const env = buildCatalogEnv(frameworkPath);

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const output = await execFile(attempt.bin, attempt.args, {
        cwd: workspaceFolder.uri.fsPath,
        env,
      });
      return JSON.parse(output);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(lastError ? lastError.message : "Unable to parse source file.");
}

async function loadCatalog(workspaceFolder) {
  const frameworkPath = resolveFrameworkPath(workspaceFolder);
  const configuredPython = getConfig("pythonPath");
  const command = "import json, sys; sys.stdout.reconfigure(encoding='utf-8'); from martin.studio import get_widget_catalog; print(json.dumps(get_widget_catalog(), ensure_ascii=False))";
  const attempts = buildPythonAttempts(configuredPython, command);
  const env = buildCatalogEnv(frameworkPath);

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const output = await execFile(attempt.bin, attempt.args, {
        cwd: workspaceFolder.uri.fsPath,
        env,
      });
      return JSON.parse(output);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Unable to load catalog from martin.studio using framework path '${frameworkPath}'. ${lastError ? lastError.message : ""}`.trim()
  );
}

async function renderSourcePreviewHtml(workspaceFolder, sourcePath) {
  const frameworkPath = resolveFrameworkPath(workspaceFolder);
  const configuredPython = getConfig("pythonPath");
  const command = [
    "import json, sys",
    "sys.stdout.reconfigure(encoding='utf-8')",
    "from martin.studio import render_source_file_preview_html",
    `print(json.dumps({'html': render_source_file_preview_html(r'''${escapePython(sourcePath)}''')}, ensure_ascii=False))`,
  ].join("; ");
  const attempts = buildPythonAttempts(configuredPython, command);
  const env = buildCatalogEnv(frameworkPath);

  for (const attempt of attempts) {
    try {
      const output = await execFile(attempt.bin, attempt.args, {
        cwd: workspaceFolder.uri.fsPath,
        env,
      });
      return JSON.parse(output).html || "";
    } catch (_error) {
    }
  }
  return "";
}

function escapePython(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function getConfig(key) {
  return vscode.workspace.getConfiguration(EXTENSION_CONFIG_KEY).get(key);
}

function buildPythonAttempts(configuredPython, command) {
  const attempts = [];
  if (configuredPython) {
    attempts.push({ bin: configuredPython, args: ["-X", "utf8", "-c", command] });
  }
  if (process.platform === "win32") {
    attempts.push({ bin: "python", args: ["-X", "utf8", "-c", command] });
    attempts.push({ bin: "py", args: ["-3", "-X", "utf8", "-c", command] });
  } else {
    attempts.push({ bin: "python3", args: ["-X", "utf8", "-c", command] });
    attempts.push({ bin: "python", args: ["-X", "utf8", "-c", command] });
  }
  return attempts;
}

function buildCatalogEnv(frameworkPath) {
  const env = { ...process.env };
  const current = env.PYTHONPATH ? [env.PYTHONPATH] : [];
  env.PYTHONPATH = [frameworkPath, ...current].join(path.delimiter);
  env.PYTHONIOENCODING = "utf-8";
  env.PYTHONUTF8 = "1";
  return env;
}

function resolveFrameworkPath(workspaceFolder) {
  const configuredPath = String(getConfig("frameworkPath") || "").trim();
  if (configuredPath && fs.existsSync(path.join(configuredPath, "martin", "studio.py"))) {
    return configuredPath;
  }

  const candidates = [
    path.join(workspaceFolder.uri.fsPath, "martin_framework"),
    path.join(workspaceFolder.uri.fsPath, "..", "martin_framework"),
    path.join(__dirname, "..", "..", "martin_framework"),
    path.join(__dirname, "..", "..", "..", "martin_framework"),
  ];

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(path.join(resolved, "martin", "studio.py"))) {
      return resolved;
    }
  }

  return workspaceFolder.uri.fsPath;
}

function execFile(bin, args, options) {
  return new Promise((resolve, reject) => {
    cp.execFile(bin, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

function getWebviewHtml(webview, extensionUri) {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "studio.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "studio.css"));
  const nonce = String(Date.now());
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <link rel="stylesheet" href="${styleUri}">
  <title>MARTIN Studio</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}">
    window.__MARTIN_STUDIO__ = {
      vscode: acquireVsCodeApi()
    };
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

module.exports = {
  activate,
  deactivate,
};
