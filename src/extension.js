const vscode = require("vscode");
const cp = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");
const https = require("https");

const DESIGN_FILE = "martin-studio.design.json";
const EXTENSION_CONFIG_KEY = "martinStudio";
const SEARCH_EXCLUDES = "**/{.git,.venv,venv,__pycache__,node_modules,dist,build}/**";

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
          sourceContext = buildSourceContext(workspaceFolder, uri.fsPath);
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
  const panelTitle = sourceContext && sourceContext.path
    ? `MARTIN Studio - ${path.basename(sourceContext.path)}`
    : "MARTIN Studio";

  const panel = vscode.window.createWebviewPanel(
    "martinStudio",
    panelTitle,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
    }
  );
  panel.iconPath = {
    light: vscode.Uri.joinPath(context.extensionUri, "media", "martin-icon.svg"),
    dark: vscode.Uri.joinPath(context.extensionUri, "media", "martin-icon.svg"),
  };

  panel.webview.html = getWebviewHtml(panel.webview, context.extensionUri);

  panel.webview.onDidReceiveMessage(async (message) => {
    try {
      if (message.type === "ready" || message.type === "refreshStudio") {
        const bootstrap = await buildStudioBootstrap(workspaceFolder, sourceContext);
        panel.title = sourceContext && sourceContext.path
          ? `MARTIN Studio - ${path.basename(sourceContext.path)}`
          : "MARTIN Studio";
        panel.webview.postMessage({
          type: "bootstrap",
          payload: bootstrap,
        });
        return;
      }

      if (message.type === "saveDesign") {
        await saveDesignDocument(workspaceFolder, message.payload.design);
        if (message.payload.functionCode && sourceContext && sourceContext.path) {
          await updateSourceFunction(
            workspaceFolder,
            sourceContext.path,
            sourceContext.functionName,
            message.payload.functionCode,
            message.payload.martinImports || []
          );
          vscode.window.setStatusBarMessage(`MARTIN Studio saved to ${sourceContext.relativePath}`, 3000);
        } else {
          vscode.window.setStatusBarMessage("MARTIN Studio design saved", 2000);
        }
        const refreshed = await buildStudioBootstrap(workspaceFolder, sourceContext);
        panel.title = sourceContext && sourceContext.path
          ? `MARTIN Studio - ${path.basename(sourceContext.path)}`
          : "MARTIN Studio";
        panel.webview.postMessage({
          type: "saveComplete",
          payload: {
            target: sourceContext && sourceContext.relativePath ? sourceContext.relativePath : DESIGN_FILE,
            ...refreshed,
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
        await openFileInEditor(path.join(workspaceFolder.uri.fsPath, DESIGN_FILE));
        return;
      }

      if (message.type === "openProjectFile" && message.payload && message.payload.path) {
        await openFileInEditor(message.payload.path);
        return;
      }

      if (message.type === "browseAsset" && message.payload) {
        const assetPath = await importAssetToWorkspace(workspaceFolder, message.payload.mediaKind || "file");
        if (assetPath) {
          panel.webview.postMessage({
            type: "assetSelected",
            payload: {
              nodeId: message.payload.nodeId,
              prop: message.payload.prop,
              value: assetPath,
            },
          });
        }
        return;
      }

      if (message.type === "openPreviewBrowser" && message.payload && message.payload.url) {
        await vscode.commands.executeCommand("simpleBrowser.show", message.payload.url);
        return;
      }

      if (message.type === "togglePreviewServer") {
        const stopped = await togglePreviewServer(workspaceFolder);
        const projectContext = await discoverProjectContext(workspaceFolder, sourceContext);
        projectContext.livePreviewOnline = stopped ? false : Boolean(projectContext.livePreviewOnline || projectContext.livePreviewUrl);
        panel.webview.postMessage({
          type: "projectContextUpdated",
          payload: projectContext,
        });
        vscode.window.setStatusBarMessage(
          stopped ? "MARTIN Studio stopped preview server" : "MARTIN Studio started `martin run` in the integrated terminal",
          3000
        );
        return;
      }
    } catch (error) {
      const text = error && error.message ? error.message : String(error);
      vscode.window.showErrorMessage(`MARTIN Studio: ${text}`);
    }
  });
}

async function buildStudioBootstrap(workspaceFolder, sourceContext) {
  const design = await loadStudioDocument(workspaceFolder, sourceContext);
  const catalog = await loadCatalog(workspaceFolder);
  const previewHtml = sourceContext && sourceContext.path
    ? await renderSourcePreviewHtml(workspaceFolder, sourceContext.path)
    : "";
  const projectContext = await discoverProjectContext(workspaceFolder, sourceContext);
  return {
    design,
    catalog,
    sourceContext,
    previewHtml,
    projectContext,
    designPath: path.join(workspaceFolder.uri.fsPath, DESIGN_FILE),
  };
}

function getWorkspaceFolder() {
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  return folder || null;
}

function buildSourceContext(workspaceFolder, filePath) {
  return {
    path: filePath,
    relativePath: path.relative(workspaceFolder.uri.fsPath, filePath),
    modulePath: toPythonModulePath(workspaceFolder, filePath),
    functionName: inferFunctionName(path.relative(workspaceFolder.uri.fsPath, filePath)),
  };
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
  return buildSourceContext(workspaceFolder, filePath);
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

async function updateSourceFunction(workspaceFolder, sourcePath, functionName, functionCode, martinImports = []) {
  const frameworkPath = resolveFrameworkPath(workspaceFolder);
  const configuredPython = getConfig("pythonPath");
  const env = buildCatalogEnv(frameworkPath);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "martin-studio-"));
  const scriptPath = path.join(tempDir, "update_source.py");
  const functionPath = path.join(tempDir, "function.py");
  const importsPath = path.join(tempDir, "imports.json");
  fs.writeFileSync(functionPath, String(functionCode), "utf8");
  fs.writeFileSync(importsPath, JSON.stringify(martinImports || []), "utf8");
  fs.writeFileSync(
    scriptPath,
    [
      "import json",
      "import pathlib",
      "import sys",
      "from martin.studio import update_source_function",
      "source_path = sys.argv[1]",
      "function_name = sys.argv[2]",
      "function_code = pathlib.Path(sys.argv[3]).read_text(encoding='utf-8')",
      "martin_imports = json.loads(pathlib.Path(sys.argv[4]).read_text(encoding='utf-8'))",
      "update_source_function(source_path, function_name, function_code, martin_imports)",
      "print('ok')",
    ].join("\n"),
    "utf8"
  );
  const attempts = buildPythonScriptAttempts(configuredPython, scriptPath, [
    sourcePath,
    String(functionName),
    functionPath,
    importsPath,
  ]);
  let lastError = null;
  try {
    for (const attempt of attempts) {
      try {
        await execFile(attempt.bin, attempt.args, {
          cwd: workspaceFolder.uri.fsPath,
          env,
        });
        return;
      } catch (error) {
        lastError = error;
      }
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  throw new Error(lastError ? lastError.message : "Unable to update source function.");
}

async function openFileInEditor(filePath) {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
  await vscode.window.showTextDocument(doc, { preview: false });
}

async function importAssetToWorkspace(workspaceFolder, mediaKind) {
  const filters = mediaKind === "video"
    ? { Videos: ["mp4", "webm", "mov", "avi", "mkv"], All: ["*"] }
    : { Images: ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"], All: ["*"] };
  const selection = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: "Add to assets",
    filters,
    defaultUri: vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, "assets")),
  });
  if (!selection || !selection.length) {
    return "";
  }

  const sourcePath = selection[0].fsPath;
  const assetsDir = path.join(workspaceFolder.uri.fsPath, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  const parsed = path.parse(sourcePath);
  let candidateName = `${parsed.name}${parsed.ext}`;
  let candidatePath = path.join(assetsDir, candidateName);
  let counter = 2;

  while (fs.existsSync(candidatePath) && path.resolve(candidatePath) !== path.resolve(sourcePath)) {
    candidateName = `${parsed.name}-${counter}${parsed.ext}`;
    candidatePath = path.join(assetsDir, candidateName);
    counter += 1;
  }

  if (path.resolve(candidatePath) !== path.resolve(sourcePath)) {
    fs.copyFileSync(sourcePath, candidatePath);
  }

  return `/${path.relative(workspaceFolder.uri.fsPath, candidatePath).replace(/\\/g, "/")}`;
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

async function discoverProjectContext(workspaceFolder, sourceContext) {
  const baseUrl = normalizePreviewBaseUrl(String(getConfig("previewBaseUrl") || ""));
  const livePreviewOnline = baseUrl ? await isPreviewUrlReachable(baseUrl) : false;
  const empty = {
    routePath: "/",
    livePreviewUrl: baseUrl || "",
    livePreviewOnline,
    frontendFiles: [],
    backendFiles: [],
  };
  if (!sourceContext || !sourceContext.path) {
    return empty;
  }

  const frontendFiles = [
    buildFileTab(workspaceFolder, sourceContext.path, "page", "Active page"),
  ];
  const related = [];
  const files = await vscode.workspace.findFiles("**/*.py", SEARCH_EXCLUDES, 300);
  for (const uri of files) {
    if (uri.fsPath === sourceContext.path) {
      continue;
    }
    const relation = scoreRelatedFile(workspaceFolder, sourceContext, uri.fsPath);
    if (relation.score > 0) {
      related.push(relation);
    }
  }

  related.sort((left, right) => right.score - left.score || left.relativePath.localeCompare(right.relativePath));

  const backendFiles = [];
  for (const relation of related.slice(0, 8)) {
    const tab = buildFileTab(workspaceFolder, relation.path, relation.kind, relation.reason);
    if (relation.kind === "backend") {
      backendFiles.push(tab);
    } else {
      frontendFiles.push(tab);
    }
  }

  const routePath = detectRoutePath(sourceContext, related) || "/";
  const livePreviewUrl = baseUrl ? joinPreviewUrl(baseUrl, routePath) : "";
  return {
    routePath,
    livePreviewUrl,
    livePreviewOnline,
    frontendFiles,
    backendFiles,
  };
}

function scoreRelatedFile(workspaceFolder, sourceContext, filePath) {
  const text = safeReadFile(filePath);
  const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);
  const modulePath = sourceContext.modulePath;
  const functionName = sourceContext.functionName;
  let score = 0;
  const reasons = [];

  if (new RegExp(`from\\s+${escapeRegExp(modulePath)}\\s+import\\s+[^\\n]*\\b${escapeRegExp(functionName)}\\b`).test(text)) {
    score += 8;
    reasons.push(`imports ${functionName}`);
  }
  if (new RegExp(`import\\s+${escapeRegExp(modulePath)}\\b`).test(text)) {
    score += 5;
    reasons.push(`imports ${modulePath}`);
  }
  if (new RegExp(`\\b${escapeRegExp(functionName)}\\b`).test(text)) {
    score += 2;
  }
  if (new RegExp(`router\\.add\\(\\s*['"][^'"]+['"]\\s*,\\s*${escapeRegExp(functionName)}\\b`, "s").test(text)) {
    score += 6;
    reasons.push("registers route");
  }
  if (new RegExp(`register_${escapeRegExp(functionName)}_backend\\b`).test(text)) {
    score += 8;
    reasons.push("registers page backend");
  }

  const hasBackendMarkers = /from\s+martin\.backend\s+import\s+Backend|\bBackend\s*\(|backend\.mount\(|register_[A-Za-z0-9_]+_backend\b/.test(text);
  if (hasBackendMarkers) {
    score += 2;
  }

  const kind = hasBackendMarkers ? "backend" : "frontend";
  return {
    path: filePath,
    relativePath,
    score,
    kind,
    reason: reasons[0] || (hasBackendMarkers ? "Backend integration" : "Project relation"),
    content: text,
  };
}

function buildFileTab(workspaceFolder, filePath, kind, reason) {
  return {
    path: filePath,
    relativePath: path.relative(workspaceFolder.uri.fsPath, filePath),
    name: path.basename(filePath),
    kind,
    reason,
    content: safeReadFile(filePath),
  };
}

function detectRoutePath(sourceContext, relations) {
  const functionName = sourceContext.functionName;
  const routeRegex = new RegExp(`router\\.add\\(\\s*['"]([^'"]+)['"]\\s*,\\s*${escapeRegExp(functionName)}\\b`, "s");
  for (const relation of relations) {
    const match = routeRegex.exec(relation.content || "");
    if (match && match[1]) {
      return match[1];
    }
  }
  if (sourceContext.relativePath.startsWith(`pages${path.sep}`) || sourceContext.relativePath.startsWith("pages/")) {
    return sourceContext.functionName === "home" ? "/" : `/${sourceContext.functionName}`;
  }
  return "/";
}

function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function toPythonModulePath(workspaceFolder, filePath) {
  const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);
  return relativePath.replace(/\\/g, "/").replace(/\.py$/i, "").split("/").filter(Boolean).join(".");
}

function inferFunctionName(relativePath) {
  const fileName = String(relativePath || "build.py").split(/[\\/]/).pop() || "build.py";
  const stem = fileName.replace(/\.py$/i, "");
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(stem) ? stem : "build";
}

function normalizePreviewBaseUrl(url) {
  const trimmed = String(url || "").trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.replace(/\/+$/, "");
}

function joinPreviewUrl(baseUrl, routePath) {
  const normalizedRoute = routePath.startsWith("/") ? routePath : `/${routePath}`;
  return `${baseUrl}${normalizedRoute}`;
}

async function runPreviewServer(workspaceFolder) {
  const terminalName = "MARTIN Preview";
  let terminal = vscode.window.terminals.find((item) => item.name === terminalName) || null;
  if (!terminal) {
    terminal = vscode.window.createTerminal({
      name: terminalName,
      cwd: workspaceFolder.uri.fsPath,
    });
  }
  terminal.show(true);
  terminal.sendText("martin run", true);
}

async function togglePreviewServer(workspaceFolder) {
  const terminalName = "MARTIN Preview";
  const terminal = vscode.window.terminals.find((item) => item.name === terminalName) || null;
  const previewBaseUrl = normalizePreviewBaseUrl(String(getConfig("previewBaseUrl") || ""));
  const running = previewBaseUrl ? await isPreviewUrlReachable(previewBaseUrl) : false;
  if (running && terminal) {
    terminal.show(true);
    terminal.sendText("\u0003", false);
    return true;
  }
  await runPreviewServer(workspaceFolder);
  return false;
}

function isPreviewUrlReachable(urlText) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(urlText);
      const client = parsed.protocol === "https:" ? https : http;
      const request = client.request(
        {
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname || "/",
          method: "GET",
          timeout: 1500,
        },
        (response) => {
          response.resume();
          resolve(response.statusCode && response.statusCode < 500);
        }
      );
      request.on("error", () => resolve(false));
      request.on("timeout", () => {
        request.destroy();
        resolve(false);
      });
      request.end();
    } catch {
      resolve(false);
    }
  });
}

function escapePython(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function buildPythonScriptAttempts(configuredPython, scriptPath, scriptArgs) {
  const attempts = [];
  if (configuredPython) {
    attempts.push({ bin: configuredPython, args: ["-X", "utf8", scriptPath, ...scriptArgs] });
  }
  if (process.platform === "win32") {
    attempts.push({ bin: "python", args: ["-X", "utf8", scriptPath, ...scriptArgs] });
    attempts.push({ bin: "py", args: ["-3", "-X", "utf8", scriptPath, ...scriptArgs] });
  } else {
    attempts.push({ bin: "python3", args: ["-X", "utf8", scriptPath, ...scriptArgs] });
    attempts.push({ bin: "python", args: ["-X", "utf8", scriptPath, ...scriptArgs] });
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data: https: http:; frame-src ${webview.cspSource} https: http:;" />
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
