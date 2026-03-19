const vscode = window.__MARTIN_STUDIO__.vscode;

const state = {
  catalog: null,
  design: null,
  selectedId: null,
  codeTab: "frontend",
  sourceContext: null,
  projectContext: null,
  lastSavedTarget: "",
  previewHtml: "",
  activeCodeFiles: {
    frontend: "",
    backend: "",
  },
  collapsed: {
    palette: false,
    inspector: false,
    bottom: false,
  },
};

const POSITIONAL_PROP_MAP = {
  Raw: "html",
  StyleTag: "css",
  Stylesheet: "href",
  Image: "src",
  Video: "src",
  Text: "content",
  Heading: "content",
  Paragraph: "content",
  Button: "label",
  Code: "content",
  Link: "content",
};

function uid(prefix = "node") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function init() {
  window.addEventListener("message", onMessage);
  vscode.postMessage({ type: "ready" });
}

function onMessage(event) {
  const message = event.data;
  if (message.type === "bootstrap") {
    state.catalog = message.payload.catalog;
    state.design = message.payload.design;
    state.sourceContext = message.payload.sourceContext || null;
    state.projectContext = message.payload.projectContext || null;
    state.previewHtml = message.payload.previewHtml || "";
    state.selectedId = state.design.root.id;
    initializeCodeFileSelection();
    render();
    return;
  }
  if (message.type === "catalogReloaded") {
    state.catalog = message.payload;
    render();
    return;
  }
  if (message.type === "saveComplete") {
    state.lastSavedTarget = message.payload.target || "";
    state.previewHtml = message.payload.previewHtml || state.previewHtml;
    state.projectContext = message.payload.projectContext || state.projectContext;
    state.catalog = message.payload.catalog || state.catalog;
    initializeCodeFileSelection();
    render();
  }
}

function initializeCodeFileSelection() {
  for (const kind of ["frontend", "backend"]) {
    const files = getCodeFiles(kind);
    const existing = state.activeCodeFiles[kind];
    if (existing && files.some((file) => file.path === existing)) {
      continue;
    }
    state.activeCodeFiles[kind] = files[0] ? files[0].path : "__generated__";
  }
}

function render() {
  if (!state.catalog || !state.design) {
    document.getElementById("app").innerHTML = `<div class="empty-state">Loading MARTIN Studio...</div>`;
    return;
  }

  document.getElementById("app").innerHTML = `
    <div class="studio-shell ${state.collapsed.palette ? "is-palette-collapsed" : ""} ${state.collapsed.inspector ? "is-inspector-collapsed" : ""} ${state.collapsed.bottom ? "is-bottom-collapsed" : ""}">
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark"></span>
          <h1>MARTIN Studio</h1>
          <span class="pill">${state.catalog.widget_count} widgets</span>
          ${state.sourceContext ? `<span class="hint">Source: ${escapeHtml(state.sourceContext.relativePath)}</span>` : `<span class="hint">Source: design JSON</span>`}
          ${state.projectContext && state.projectContext.routePath ? `<span class="pill route-pill">Route ${escapeHtml(state.projectContext.routePath)}</span>` : ""}
          ${state.lastSavedTarget ? `<span class="pill">Saved: ${escapeHtml(state.lastSavedTarget)}</span>` : ""}
        </div>
        <div class="topbar-actions">
          ${state.sourceContext ? `<button class="btn" data-action="open-page-source">Open page file</button>` : ""}
          ${state.projectContext && state.projectContext.livePreviewUrl ? `<button class="btn icon-topbar-btn" data-action="open-browser-preview" title="Open preview in browser tab" aria-label="Open preview in browser tab">🌐</button>` : ""}
          ${state.projectContext && state.projectContext.livePreviewUrl ? `<button class="btn icon-topbar-btn play-btn" data-action="toggle-preview-server" title="${state.projectContext.livePreviewOnline ? "Stop martin run" : "Run martin run"}" aria-label="${state.projectContext.livePreviewOnline ? "Stop martin run" : "Run martin run"}">${state.projectContext.livePreviewOnline ? "■" : "▶"}</button>` : ""}
          <button class="btn icon-topbar-btn" data-action="reload-catalog" title="Reload catalog" aria-label="Reload catalog">↻</button>
          <button class="btn" data-action="open-source">Open design JSON</button>
          <button class="btn icon-topbar-btn" data-action="save-design" title="${state.sourceContext ? "Save to source" : "Save"}" aria-label="${state.sourceContext ? "Save to source" : "Save"}">💾</button>
        </div>
      </header>
      <aside class="sidebar">${renderPalette()}</aside>
      <main class="canvas-wrap">
        <div class="canvas-surface">
          <p class="section-title">Canvas</p>
          ${renderCanvas()}
        </div>
      </main>
      <aside class="inspector">${renderInspector()}</aside>
      <section class="code-panel">
        <div class="tabs">
          <button class="tab panel-toggle ${state.collapsed.bottom ? "is-active" : ""}" data-action="toggle-panel" data-panel="bottom" title="${state.collapsed.bottom ? "Expand bottom panel" : "Collapse bottom panel"}">${state.collapsed.bottom ? "▴" : "▾"}</button>
          <button class="tab ${state.codeTab === "frontend" ? "is-active" : ""}" data-tab="frontend">Frontend</button>
          <button class="tab ${state.codeTab === "backend" ? "is-active" : ""}" data-tab="backend">Backend</button>
          <button class="tab ${state.codeTab === "json" ? "is-active" : ""}" data-tab="json">Design JSON</button>
        </div>
        <div class="code-body">
          ${renderBottomPanel()}
        </div>
      </section>
    </div>
  `;

  bindGlobalActions();
  bindPaletteDrag();
  bindDropzones();
  bindNodeActions();
  bindInspector();
  bindCodeTabs();
}

function renderPalette() {
  const groups = new Map();
  for (const widget of state.catalog.widgets) {
    if (!groups.has(widget.category)) {
      groups.set(widget.category, []);
    }
    groups.get(widget.category).push(widget);
  }

  return `
    <div class="panel-head">
      <p class="section-title">Palette</p>
      <button class="icon-btn panel-toggle" data-action="toggle-panel" data-panel="palette" title="${state.collapsed.palette ? "Expand palette" : "Collapse palette"}">${state.collapsed.palette ? "▸" : "◂"}</button>
    </div>
    ${Array.from(groups.entries()).map(([category, widgets]) => `
      <section class="catalog-group">
        <h3>${escapeHtml(category)}</h3>
        ${widgets.map((widget) => `
          <button class="palette-item" draggable="true" data-widget="${escapeHtml(widget.name)}" title="${escapeHtml(widget.summary || widget.name)}">
            ${escapeHtml(widget.name)}
            <small>${escapeHtml(widget.summary || widget.category)}</small>
          </button>
        `).join("")}
      </section>
    `).join("")}
  `;
}

function renderCanvas() {
  return renderNode(state.design.root, true);
}

function renderNode(node, isRoot = false) {
  const widget = getWidget(node.type);
  const selected = state.selectedId === node.id ? "is-selected" : "";
  const canReceiveChildren = widget && widget.accepts_children;
  const children = Array.isArray(node.children) ? node.children : [];

  return `
    <article class="node-card ${selected}" data-node-id="${escapeHtml(node.id)}">
      <div class="node-head">
        <div>
          <div class="node-title">${escapeHtml(node.type)}</div>
          <div class="node-meta">${escapeHtml(summarizeNode(node))}</div>
        </div>
        <div class="node-actions">
          ${!isRoot ? `<button class="icon-btn" data-action="duplicate-node" data-node-id="${escapeHtml(node.id)}">Duplicate</button>` : ""}
          ${!isRoot ? `<button class="icon-btn" data-action="delete-node" data-node-id="${escapeHtml(node.id)}">Delete</button>` : ""}
        </div>
      </div>
      ${canReceiveChildren ? `
        ${children.map((child) => renderNode(child)).join("")}
        <div class="dropzone" data-drop-parent="${escapeHtml(node.id)}">Drop widget here</div>
      ` : `<div class="hint">Leaf widget</div>`}
    </article>
  `;
}

function renderInspector() {
  const node = findNodeById(state.design.root, state.selectedId);
  if (!node) {
    return `<div class="empty-state">Select a widget to edit its properties.</div>`;
  }

  const widget = getWidget(node.type);
  if (!widget) {
    return `<div class="empty-state">Unknown widget: ${escapeHtml(node.type)}</div>`;
  }

  const editableParams = widget.params.filter((param) => !param.structural && param.name !== "style");

  return `
    <div class="panel-head">
      <p class="section-title">Inspector</p>
      <button class="icon-btn panel-toggle" data-action="toggle-panel" data-panel="inspector" title="${state.collapsed.inspector ? "Expand inspector" : "Collapse inspector"}">${state.collapsed.inspector ? "▸" : "▸"}</button>
    </div>
    <h2 style="margin:0 0 8px">${escapeHtml(node.type)}</h2>
    <p class="hint" style="margin:0 0 16px">${escapeHtml(widget.summary || "")}</p>
    <div class="props-grid">
      ${editableParams.map((param) => renderField(node, widget, param)).join("")}
    </div>
  `;
}

function renderField(node, widget, param) {
  const current = node.props && Object.prototype.hasOwnProperty.call(node.props, param.name)
    ? node.props[param.name]
    : (widget.preset_props && Object.prototype.hasOwnProperty.call(widget.preset_props, param.name)
      ? widget.preset_props[param.name]
      : param.default);
  const fieldId = `${node.id}_${param.name}`;
  const common = `data-node-id="${escapeHtml(node.id)}" data-prop="${escapeHtml(param.name)}"`;

  if (param.editor && param.editor.type === "collection") {
    const items = Array.isArray(current) ? current : [];
    return `
      <div class="field">
        <div class="field-head">
          <label>${escapeHtml(param.name)}</label>
          <button
            type="button"
            class="mini-btn"
            data-editor-action="add-collection-item"
            ${common}
          >Add ${escapeHtml(param.editor.item_label || "item")}</button>
        </div>
        <div class="collection-editor">
          ${items.length ? items.map((item, index) => renderCollectionItemEditor(node, param, item, index)).join("") : `
            <div class="editor-empty">No items yet.</div>
          `}
        </div>
      </div>
    `;
  }

  if (param.editor && param.editor.type === "key_value") {
    const entries = Object.entries(current || {});
    return `
      <div class="field">
        <div class="field-head">
          <label>${escapeHtml(param.name)}</label>
          <button
            type="button"
            class="mini-btn"
            data-editor-action="add-key-value-entry"
            ${common}
          >Add ${escapeHtml(param.editor.entry_label || "entry")}</button>
        </div>
        <div class="collection-editor">
          ${entries.length ? entries.map(([key, value], index) => renderKeyValueEditorRow(node, param, key, value, index)).join("") : `
            <div class="editor-empty">No entries yet.</div>
          `}
        </div>
      </div>
    `;
  }

  if (param.type === "boolean") {
    return `
      <div class="field">
        <label for="${escapeHtml(fieldId)}">${escapeHtml(param.name)}</label>
        <input type="checkbox" id="${escapeHtml(fieldId)}" ${common} data-field-type="boolean" ${current ? "checked" : ""}>
      </div>
    `;
  }

  if (param.type === "enum") {
    return `
      <div class="field">
        <label for="${escapeHtml(fieldId)}">${escapeHtml(param.name)}</label>
        <select id="${escapeHtml(fieldId)}" ${common} data-field-type="enum">
          ${param.options.map((option) => `
            <option value="${escapeHtml(String(option))}" ${String(current ?? "") === String(option) ? "selected" : ""}>${escapeHtml(String(option))}</option>
          `).join("")}
        </select>
      </div>
    `;
  }

  if (param.type === "array" || param.type === "object") {
    return `
      <div class="field">
        <label for="${escapeHtml(fieldId)}">${escapeHtml(param.name)}</label>
        <textarea id="${escapeHtml(fieldId)}" ${common} data-field-type="${escapeHtml(param.type)}">${escapeHtml(current ? JSON.stringify(current, null, 2) : "")}</textarea>
      </div>
    `;
  }

  const inputType = param.type === "integer" || param.type === "float" ? "number" : "text";
  const value = current === null || current === undefined ? "" : String(current);
  return `
    <div class="field">
      <label for="${escapeHtml(fieldId)}">${escapeHtml(param.name)}</label>
      <input type="${inputType}" id="${escapeHtml(fieldId)}" value="${escapeHtml(value)}" ${common} data-field-type="${escapeHtml(param.type)}">
    </div>
  `;
}

function renderCollectionItemEditor(node, param, item, index) {
  const fields = Array.isArray(param.editor.fields) ? param.editor.fields : [];
  return `
    <div class="collection-card">
      <div class="collection-card-head">
        <strong>${escapeHtml(param.editor.item_label || "Item")} ${index + 1}</strong>
        <button
          type="button"
          class="mini-btn danger"
          data-editor-action="remove-collection-item"
          data-node-id="${escapeHtml(node.id)}"
          data-prop="${escapeHtml(param.name)}"
          data-index="${index}"
        >Remove</button>
      </div>
      <div class="collection-grid">
        ${fields.map((field) => renderCollectionField(node, param, item, index, field)).join("")}
      </div>
    </div>
  `;
}

function renderCollectionField(node, param, item, index, field) {
  const fieldId = `${node.id}_${param.name}_${index}_${field.name}`;
  const current = item && Object.prototype.hasOwnProperty.call(item, field.name) ? item[field.name] : "";
  const common = `
    data-editor-kind="collection-field"
    data-node-id="${escapeHtml(node.id)}"
    data-prop="${escapeHtml(param.name)}"
    data-index="${index}"
    data-item-field="${escapeHtml(field.name)}"
    data-item-type="${escapeHtml(field.type || "string")}"
  `;
  const inputType = editorInputType(field.type);
  return `
    <div class="field compact">
      <label for="${escapeHtml(fieldId)}">${escapeHtml(field.label || field.name)}</label>
      <input
        type="${escapeHtml(inputType)}"
        id="${escapeHtml(fieldId)}"
        value="${escapeHtml(current)}"
        ${common}
      >
    </div>
  `;
}

function renderKeyValueEditorRow(node, param, key, value, index) {
  const keyId = `${node.id}_${param.name}_${index}_key`;
  const valueId = `${node.id}_${param.name}_${index}_value`;
  return `
    <div class="kv-row">
      <div class="field compact">
        <label for="${escapeHtml(keyId)}">${escapeHtml(param.editor.key_label || "Key")}</label>
        <input
          type="text"
          id="${escapeHtml(keyId)}"
          value="${escapeHtml(key)}"
          placeholder="${escapeHtml(param.editor.key_placeholder || "")}"
          data-editor-kind="key-value-key"
          data-node-id="${escapeHtml(node.id)}"
          data-prop="${escapeHtml(param.name)}"
          data-index="${index}"
        >
      </div>
      <div class="field compact">
        <label for="${escapeHtml(valueId)}">${escapeHtml(param.editor.value_label || "Value")}</label>
        <input
          type="${escapeHtml(editorInputType(param.editor.value_type || "string"))}"
          id="${escapeHtml(valueId)}"
          value="${escapeHtml(value)}"
          placeholder="${escapeHtml(param.editor.value_placeholder || "")}"
          data-editor-kind="key-value-value"
          data-node-id="${escapeHtml(node.id)}"
          data-prop="${escapeHtml(param.name)}"
          data-index="${index}"
          data-value-type="${escapeHtml(param.editor.value_type || "string")}"
        >
      </div>
      <button
        type="button"
        class="mini-btn danger align-end"
        data-editor-action="remove-key-value-entry"
        data-node-id="${escapeHtml(node.id)}"
        data-prop="${escapeHtml(param.name)}"
        data-index="${index}"
      >Remove</button>
    </div>
  `;
}

function renderCodeTab() {
  if (state.codeTab === "json") {
    return JSON.stringify(state.design, null, 2);
  }
  if (state.codeTab === "backend") {
    return generateBackendCode(state.design);
  }
  return generateFrontendCode(state.design);
}

function renderBottomPanel() {
  if (state.codeTab === "frontend" || state.codeTab === "backend") {
    return renderCodeWorkspace(state.codeTab);
  }
  return `<textarea class="code-block" readonly>${escapeHtml(renderCodeTab())}</textarea>`;
}

function bindGlobalActions() {
  document.querySelector('[data-action="save-design"]').addEventListener("click", saveDesign);
  document.querySelector('[data-action="reload-catalog"]').addEventListener("click", () => vscode.postMessage({ type: "reloadCatalog" }));
  document.querySelector('[data-action="open-source"]').addEventListener("click", () => vscode.postMessage({ type: "openDesignSource" }));
  const pageButton = document.querySelector('[data-action="open-page-source"]');
  if (pageButton) {
    pageButton.addEventListener("click", () => vscode.postMessage({ type: "openProjectFile", payload: { path: state.sourceContext.path } }));
  }
  document.querySelectorAll('[data-action="open-browser-preview"]').forEach((button) => {
    button.addEventListener("click", () => openRealPreviewTab());
  });
  document.querySelectorAll('[data-action="refresh-preview"]').forEach((button) => {
    button.addEventListener("click", () => vscode.postMessage({ type: "refreshStudio" }));
  });
  document.querySelectorAll('[data-action="run-preview-server"]').forEach((button) => {
    button.addEventListener("click", () => vscode.postMessage({ type: "togglePreviewServer" }));
  });
  document.querySelectorAll('[data-action="toggle-preview-server"]').forEach((button) => {
    button.addEventListener("click", () => vscode.postMessage({ type: "togglePreviewServer" }));
  });
  document.querySelectorAll('[data-action="toggle-panel"]').forEach((button) => {
    button.addEventListener("click", () => togglePanel(button.dataset.panel));
  });
  bindCodeWorkspaceActions();
}

function bindPaletteDrag() {
  document.querySelectorAll(".palette-item").forEach((element) => {
    element.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("application/martin-widget", element.dataset.widget);
    });
  });
}

function bindDropzones() {
  document.querySelectorAll(".dropzone").forEach((zone) => {
    zone.addEventListener("dragover", (event) => {
      event.preventDefault();
      zone.classList.add("is-over");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("is-over"));
    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      zone.classList.remove("is-over");
      const widgetName = event.dataTransfer.getData("application/martin-widget");
      if (widgetName) {
        addNode(zone.dataset.dropParent, widgetName);
      }
    });
  });
}

function bindNodeActions() {
  document.querySelectorAll(".node-card").forEach((card) => {
    card.addEventListener("click", (event) => {
      event.stopPropagation();
      if (event.target.closest("button")) {
        return;
      }
      state.selectedId = event.currentTarget.dataset.nodeId;
      render();
    });
  });

  document.querySelectorAll('[data-action="delete-node"]').forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteNode(button.dataset.nodeId);
    });
  });
  document.querySelectorAll('[data-action="duplicate-node"]').forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      duplicateNode(button.dataset.nodeId);
    });
  });
}

function bindInspector() {
  document.querySelectorAll("[data-prop]").forEach((field) => {
    if (field.dataset.editorAction) {
      return;
    }
    const tagName = field.tagName.toLowerCase();
    const eventName = field.type === "checkbox" || tagName === "select" || field.type === "date" || field.type === "time" || field.type === "color" ? "change" : "blur";
    field.addEventListener(eventName, () => updateProp(field.dataset.nodeId, field.dataset.prop, readFieldValue(field)));
  });

  document.querySelectorAll('[data-editor-action="add-collection-item"]').forEach((button) => {
    button.addEventListener("click", () => addCollectionItem(button.dataset.nodeId, button.dataset.prop));
  });
  document.querySelectorAll('[data-editor-action="remove-collection-item"]').forEach((button) => {
    button.addEventListener("click", () => removeCollectionItem(button.dataset.nodeId, button.dataset.prop, Number(button.dataset.index)));
  });
  document.querySelectorAll('[data-editor-action="add-key-value-entry"]').forEach((button) => {
    button.addEventListener("click", () => addKeyValueEntry(button.dataset.nodeId, button.dataset.prop));
  });
  document.querySelectorAll('[data-editor-action="remove-key-value-entry"]').forEach((button) => {
    button.addEventListener("click", () => removeKeyValueEntry(button.dataset.nodeId, button.dataset.prop, Number(button.dataset.index)));
  });
  document.querySelectorAll('[data-editor-kind="collection-field"]').forEach((field) => {
    const eventName = field.type === "date" || field.type === "time" || field.type === "color" ? "change" : "blur";
    field.addEventListener(eventName, () => updateCollectionField(
      field.dataset.nodeId,
      field.dataset.prop,
      Number(field.dataset.index),
      field.dataset.itemField,
      field.dataset.itemType,
      field.value,
    ));
  });
  document.querySelectorAll('[data-editor-kind="key-value-key"], [data-editor-kind="key-value-value"]').forEach((field) => {
    const eventName = field.type === "number" ? "blur" : "blur";
    field.addEventListener(eventName, () => updateKeyValueEntry(
      field.dataset.nodeId,
      field.dataset.prop,
      Number(field.dataset.index),
    ));
  });
}

function bindCodeTabs() {
  document.querySelectorAll("[data-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.codeTab = tab.dataset.tab;
      render();
    });
  });
}

function togglePanel(panel) {
  if (!panel || !Object.prototype.hasOwnProperty.call(state.collapsed, panel)) {
    return;
  }
  state.collapsed[panel] = !state.collapsed[panel];
  render();
}

function openRealPreviewTab() {
  const livePreviewUrl = state.projectContext && state.projectContext.livePreviewUrl ? state.projectContext.livePreviewUrl : "";
  if (!livePreviewUrl) {
    return;
  }
  state.previewAutoOpened = true;
  vscode.postMessage({
    type: "openPreviewBrowser",
    payload: { url: livePreviewUrl },
  });
}

function bindCodeWorkspaceActions() {
  document.querySelectorAll("[data-file-kind][data-file-path]").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.activeCodeFiles[tab.dataset.fileKind] = tab.dataset.filePath;
      render();
    });
  });
  document.querySelectorAll('[data-action="open-workspace-file"]').forEach((button) => {
    button.addEventListener("click", () => vscode.postMessage({
      type: "openProjectFile",
      payload: { path: button.dataset.path },
    }));
  });
}

function renderPreviewNode(node) {
  const props = node.props || {};
  const childHtml = (node.children || []).map((child) => renderPreviewNode(child)).join("");
  const extraStyle = styleString(props.style);

  if (node.type === "Column") {
    return `<div style="display:flex;flex-direction:column;gap:${num(props.gap, 8)}px;${boxStyle(props)}${extraStyle}">${childHtml}</div>`;
  }
  if (node.type === "Row") {
    return `<div style="display:flex;flex-direction:row;flex-wrap:${props.wrap ? "wrap" : "nowrap"};align-items:${props.align || "center"};justify-content:${props.justify || "flex-start"};gap:${num(props.gap, 8)}px;${boxStyle(props)}${extraStyle}">${childHtml}</div>`;
  }
  if (node.type === "Grid") {
    const cols = typeof props.columns === "number" ? `repeat(${props.columns}, 1fr)` : (props.columns || "repeat(2, 1fr)");
    return `<div style="display:grid;grid-template-columns:${cols};gap:${num(props.gap, 16)}px;${boxStyle(props)}${extraStyle}">${childHtml}</div>`;
  }
  if (node.type === "Card") {
    return `<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:${num(props.radius, 12)}px;padding:${num(props.padding, 16)}px;${boxStyle(props)}${extraStyle}">${childHtml}</div>`;
  }
  if (node.type === "Heading") {
    const level = Math.max(1, Math.min(6, Number(props.level || 1)));
    return `<h${level} style="margin:0;color:${props.color || "var(--text)"};${extraStyle}">${escapeHtml(props.content || "Heading")}</h${level}>`;
  }
  if (node.type === "Paragraph") {
    return `<p style="margin:0;line-height:1.6;color:${props.color || "var(--muted)"};${extraStyle}">${escapeHtml(props.content || "")}</p>`;
  }
  if (node.type === "Text") {
    return `<span style="${extraStyle}">${escapeHtml(props.content || "")}</span>`;
  }
  if (node.type === "Button") {
    const isGhost = props.variant === "ghost";
    return `<button style="padding:10px 16px;border-radius:${num(props.radius, 8)}px;border:1px solid ${isGhost ? "rgba(255,255,255,0.18)" : "transparent"};background:${isGhost ? "transparent" : "#2f81f7"};color:#fff;cursor:default;${extraStyle}">${escapeHtml(props.label || "Button")}</button>`;
  }
  if (node.type === "Divider") {
    return `<div style="height:1px;width:100%;background:rgba(255,255,255,0.12);margin:4px 0;"></div>`;
  }
  if (node.type === "Code") {
    return `<pre style="margin:0;padding:12px;border-radius:12px;background:#0b0f14;color:#dce7f3;overflow:auto;${extraStyle}"><code>${escapeHtml(props.content || "")}</code></pre>`;
  }
  if (node.type === "Raw") {
    return `<div class="preview-raw">Raw: ${escapeHtml(props.html || "")}</div>`;
  }
  return `<div class="preview-generic" style="${boxStyle(props)}${extraStyle}"><div class="preview-label">${escapeHtml(node.type)}</div>${childHtml || `<div class="hint">${escapeHtml(summarizeNode(node))}</div>`}</div>`;
}

function addNode(parentId, widgetName) {
  const widget = getWidget(widgetName);
  const parent = findNodeById(state.design.root, parentId);
  if (!widget || !parent) {
    return;
  }
  const node = createNode(widget);
  parent.children = parent.children || [];
  parent.children.push(node);
  state.selectedId = node.id;
  render();
}

function createNode(widget) {
  const props = clone(widget.preset_props || {});
  for (const param of widget.params) {
    if (!param.structural && param.default !== null && param.default !== undefined && param.name !== "style" && props[param.name] === undefined) {
      props[param.name] = clone(param.default);
    }
  }
  if (widget.name === "Heading" && !props.content) props.content = "Heading";
  if (widget.name === "Text" && !props.content) props.content = "Text";
  if (widget.name === "Paragraph" && !props.content) props.content = "Paragraph";
  if (widget.name === "Button" && !props.label) props.label = "Button";
  return { id: uid("node"), type: widget.name, props, children: [] };
}

function deleteNode(nodeId) {
  if (nodeId === state.design.root.id) {
    return;
  }
  removeNode(state.design.root, nodeId);
  state.selectedId = state.design.root.id;
  render();
}

function duplicateNode(nodeId) {
  const target = findNodeById(state.design.root, nodeId);
  const parent = findParent(state.design.root, nodeId);
  if (!target || !parent) {
    return;
  }
  const duplicated = deepCloneNode(target);
  duplicated.id = uid("node");
  parent.children.push(duplicated);
  state.selectedId = duplicated.id;
  render();
}

function deepCloneNode(node) {
  const copied = clone(node);
  copied.children = (copied.children || []).map((child) => {
    const next = deepCloneNode(child);
    next.id = uid("node");
    return next;
  });
  return copied;
}

function updateProp(nodeId, propName, value) {
  const node = findNodeById(state.design.root, nodeId);
  if (!node) return;
  node.props = node.props || {};
  if (value === "" || value === null || value === undefined) delete node.props[propName];
  else node.props[propName] = value;
  render();
}

function addCollectionItem(nodeId, propName) {
  const node = findNodeById(state.design.root, nodeId);
  const widget = getWidget(node?.type);
  const param = getWidgetParam(widget, propName);
  if (!node || !param || !param.editor) {
    return;
  }
  const item = {};
  for (const field of param.editor.fields || []) {
    if (field.type === "color") item[field.name] = "#6366f1";
    else item[field.name] = "";
  }
  const current = Array.isArray(node.props?.[propName]) ? clone(node.props[propName]) : clone(widget.preset_props?.[propName] || []);
  current.push(item);
  updateProp(nodeId, propName, current);
}

function removeCollectionItem(nodeId, propName, index) {
  const node = findNodeById(state.design.root, nodeId);
  if (!node) {
    return;
  }
  const current = Array.isArray(node.props?.[propName]) ? clone(node.props[propName]) : [];
  current.splice(index, 1);
  updateProp(nodeId, propName, current);
}

function updateCollectionField(nodeId, propName, index, fieldName, fieldType, rawValue) {
  const node = findNodeById(state.design.root, nodeId);
  const widget = getWidget(node?.type);
  if (!node || !widget) {
    return;
  }
  const current = Array.isArray(node.props?.[propName]) ? clone(node.props[propName]) : clone(widget.preset_props?.[propName] || []);
  while (current.length <= index) {
    current.push({});
  }
  current[index] = current[index] || {};
  const value = parseEditorValue(fieldType, rawValue);
  if (value === "" || value === null || value === undefined) {
    delete current[index][fieldName];
  } else {
    current[index][fieldName] = value;
  }
  updateProp(nodeId, propName, current);
}

function addKeyValueEntry(nodeId, propName) {
  const node = findNodeById(state.design.root, nodeId);
  const widget = getWidget(node?.type);
  if (!node || !widget) {
    return;
  }
  const current = clone(node.props?.[propName] || widget.preset_props?.[propName] || {});
  let candidate = "Word";
  let counter = 2;
  while (Object.prototype.hasOwnProperty.call(current, candidate)) {
    candidate = `Word ${counter}`;
    counter += 1;
  }
  current[candidate] = 1;
  updateProp(nodeId, propName, current);
}

function removeKeyValueEntry(nodeId, propName, index) {
  const node = findNodeById(state.design.root, nodeId);
  if (!node) {
    return;
  }
  const entries = Object.entries(node.props?.[propName] || {});
  entries.splice(index, 1);
  updateProp(nodeId, propName, Object.fromEntries(entries));
}

function updateKeyValueEntry(nodeId, propName, index) {
  const node = findNodeById(state.design.root, nodeId);
  const widget = getWidget(node?.type);
  const param = getWidgetParam(widget, propName);
  if (!node || !widget || !param || !param.editor) {
    return;
  }
  const keyField = document.querySelector(`[data-editor-kind="key-value-key"][data-node-id="${cssEscape(nodeId)}"][data-prop="${cssEscape(propName)}"][data-index="${index}"]`);
  const valueField = document.querySelector(`[data-editor-kind="key-value-value"][data-node-id="${cssEscape(nodeId)}"][data-prop="${cssEscape(propName)}"][data-index="${index}"]`);
  if (!keyField || !valueField) {
    return;
  }
  const key = keyField.value.trim();
  const value = parseEditorValue(param.editor.value_type || "string", valueField.value);
  const entries = Object.entries(node.props?.[propName] || widget.preset_props?.[propName] || {});
  const previous = entries[index];
  if (!previous) {
    return;
  }
  entries[index] = [key || previous[0], value === null ? previous[1] : value];
  updateProp(nodeId, propName, Object.fromEntries(entries.filter(([entryKey]) => entryKey)));
}

function readFieldValue(field) {
  const type = field.dataset.fieldType;
  if (type === "boolean") return field.checked;
  if (type === "integer") return field.value === "" ? null : Number.parseInt(field.value, 10);
  if (type === "float") return field.value === "" ? null : Number.parseFloat(field.value);
  if (type === "array" || type === "object") {
    if (!field.value.trim()) return null;
    try {
      return JSON.parse(field.value);
    } catch {
      return field.value;
    }
  }
  return field.value;
}

function parseEditorValue(type, rawValue) {
  if (type === "integer") {
    return rawValue === "" ? null : Number.parseInt(rawValue, 10);
  }
  if (type === "float") {
    return rawValue === "" ? null : Number.parseFloat(rawValue);
  }
  return rawValue;
}

function editorInputType(type) {
  if (type === "integer" || type === "float") {
    return "number";
  }
  if (type === "date" || type === "time" || type === "color") {
    return type;
  }
  return "text";
}

function saveDesign() {
  vscode.postMessage({
    type: "saveDesign",
    payload: {
      design: state.design,
      sourceCode: generateFrontendCode(state.design),
      functionCode: generateFunctionCode(state.design),
      martinImports: getRequiredImports(state.design),
    },
  });
}

function findNodeById(node, nodeId) {
  if (!node) return null;
  if (node.id === nodeId) return node;
  for (const child of node.children || []) {
    const found = findNodeById(child, nodeId);
    if (found) return found;
  }
  return null;
}

function findParent(node, nodeId) {
  for (const child of node.children || []) {
    if (child.id === nodeId) return node;
    const found = findParent(child, nodeId);
    if (found) return found;
  }
  return null;
}

function removeNode(node, nodeId) {
  node.children = (node.children || []).filter((child) => child.id !== nodeId);
  for (const child of node.children) removeNode(child, nodeId);
}

function getWidget(name) {
  return state.catalog.widgets.find((widget) => widget.name === name) || null;
}

function getCodeFiles(kind) {
  if (!state.projectContext) {
    return [];
  }
  if (kind === "backend") {
    return state.projectContext.backendFiles || [];
  }
  return state.projectContext.frontendFiles || [];
}

function renderCodeWorkspace(kind) {
  const workspaceFiles = getCodeFiles(kind);
  const generatedTab = {
    path: "__generated__",
    relativePath: kind === "frontend" ? "Generated frontend code" : "Generated backend scaffold",
    name: "Generated",
    kind,
    reason: kind === "frontend" ? "Studio generator" : "Studio scaffold",
    content: kind === "frontend" ? generateFrontendCode(state.design) : generateBackendCode(state.design),
  };
  const files = [...workspaceFiles, generatedTab];
  const activePath = state.activeCodeFiles[kind] || generatedTab.path;
  const activeFile = files.find((file) => file.path === activePath) || generatedTab;

  return `
    <div class="workspace-code">
      <div class="workspace-toolbar">
        <div class="workspace-tabs">
          ${files.map((file) => `
            <button
              class="file-tab ${activeFile.path === file.path ? "is-active" : ""}"
              data-file-kind="${escapeHtml(kind)}"
              data-file-path="${escapeHtml(file.path)}"
            >${escapeHtml(file.name)}</button>
          `).join("")}
        </div>
        ${activeFile.path !== "__generated__" ? `
          <button class="mini-btn" data-action="open-workspace-file" data-path="${escapeHtml(activeFile.path)}">Open in Editor</button>
        ` : ""}
      </div>
      <div class="workspace-meta">
        <strong>${escapeHtml(activeFile.relativePath)}</strong>
        ${activeFile.reason ? `<span class="hint">${escapeHtml(activeFile.reason)}</span>` : ""}
      </div>
      <textarea class="code-block" readonly>${escapeHtml(activeFile.content || "")}</textarea>
    </div>
  `;
}

function getWidgetParam(widget, paramName) {
  if (!widget) {
    return null;
  }
  return widget.params.find((param) => param.name === paramName) || null;
}

function summarizeNode(node) {
  const props = node.props || {};
  if (props.content) return String(props.content).slice(0, 72);
  if (props.html) return String(props.html).slice(0, 72);
  if (props.css) return String(props.css).slice(0, 72);
  if (props.label) return String(props.label).slice(0, 72);
  const keys = Object.keys(props);
  return keys.length ? keys.join(", ") : "No props configured yet";
}

function generateFrontendCode(design) {
  const importList = getRequiredImports(design).sort().join(", ");
  if (state.sourceContext && state.sourceContext.relativePath) {
    const functionName = inferFunctionName(state.sourceContext.relativePath);
    return `from martin import ${importList}

def ${functionName}():
${nodeToPython(design.root, 1)}
`;
  }
  return `from martin import App, ${importList}

def build():
${nodeToPython(design.root, 1)}

app = App(
    build=build,
    title=${pyString(design.title || "MARTIN Studio App")},
)

if __name__ == "__main__":
    app.run()
`;
}

function generateFunctionCode(design) {
  const functionName = state.sourceContext && state.sourceContext.relativePath
    ? inferFunctionName(state.sourceContext.relativePath)
    : "build";
  return `def ${functionName}():
${nodeToPython(design.root, 1)}
`;
}

function generateBackendCode(design) {
  return `from martin.backend import Backend

backend = Backend(prefix="/api")

@backend.post("/health")
def health(req):
    return {"ok": True, "designer": ${pyString(design.title || "MARTIN Studio Design")}}

def mount_backend(app):
    backend.mount(app)
    return app
`;
}

function collectImports(node, imports) {
  imports.add(node.type);
  for (const child of node.children || []) collectImports(child, imports);
}

function getRequiredImports(design) {
  const imports = new Set();
  collectImports(design.root, imports);
  return Array.from(imports);
}

function nodeToPython(node, depth) {
  const indent = "    ".repeat(depth);
  const lines = [];
  const props = [];
  const positionalProp = POSITIONAL_PROP_MAP[node.type];
  const nodeProps = { ...(node.props || {}) };
  if (positionalProp && nodeProps[positionalProp] !== undefined) {
    props.push(pyValue(nodeProps[positionalProp], depth + 1));
    delete nodeProps[positionalProp];
  }
  for (const [key, value] of Object.entries(nodeProps)) props.push(`${key}=${pyValue(value, depth + 1)}`);
  if (node.children && node.children.length) {
    const childrenCode = node.children.map((child) => nodeToExpression(child, depth + 2)).join(",\n");
    props.push(`children=[\n${childrenCode}\n${indent}    ]`);
  }
  lines.push(`${indent}return ${node.type}(`);
  for (const prop of props) lines.push(`${indent}    ${prop},`);
  lines.push(`${indent})`);
  return lines.join("\n");
}

function nodeToExpression(node, depth) {
  const indent = "    ".repeat(depth);
  const props = [];
  const positionalProp = POSITIONAL_PROP_MAP[node.type];
  const nodeProps = { ...(node.props || {}) };
  if (positionalProp && nodeProps[positionalProp] !== undefined) {
    props.push(pyValue(nodeProps[positionalProp], depth + 1));
    delete nodeProps[positionalProp];
  }
  for (const [key, value] of Object.entries(nodeProps)) props.push(`${key}=${pyValue(value, depth + 1)}`);
  if (node.children && node.children.length) {
    const childrenCode = node.children.map((child) => nodeToExpression(child, depth + 2)).join(",\n");
    props.push(`children=[\n${childrenCode}\n${indent}    ]`);
  }
  if (!props.length) return `${indent}${node.type}()`;
  return `${indent}${node.type}(\n${props.map((prop) => `${indent}    ${prop}`).join(",\n")}\n${indent})`;
}

function pyValue(value, depth) {
  const indent = "    ".repeat(depth);
  if (typeof value === "string") return pyString(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "True" : "False";
  if (value === null) return "None";
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return `[\n${value.map((item) => `${indent}${pyValue(item, depth + 1)}`).join(",\n")}\n${"    ".repeat(depth - 1)}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) return "{}";
    return `{\n${entries.map(([key, entryValue]) => `${indent}${pyString(key)}: ${pyValue(entryValue, depth + 1)}`).join(",\n")}\n${"    ".repeat(depth - 1)}}`;
  }
  return pyString(String(value));
}

function pyString(text) {
  return JSON.stringify(String(text));
}

function inferFunctionName(relativePath) {
  const fileName = String(relativePath || "build.py").split(/[\\/]/).pop() || "build.py";
  const stem = fileName.replace(/\.py$/i, "");
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(stem) ? stem : "build";
}

function num(value, fallback) {
  return typeof value === "number" ? value : fallback;
}

function styleString(value) {
  return typeof value === "string" ? value : "";
}

function boxStyle(props) {
  const parts = [];
  if (typeof props.padding === "number") parts.push(`padding:${props.padding}px;`);
  if (typeof props.margin === "number") parts.push(`margin:${props.margin}px;`);
  if (props.width !== undefined) parts.push(`width:${typeof props.width === "number" ? `${props.width}px` : props.width};`);
  if (props.height !== undefined) parts.push(`height:${typeof props.height === "number" ? `${props.height}px` : props.height};`);
  if (props.background) parts.push(`background:${props.background};`);
  if (props.color) parts.push(`color:${props.color};`);
  if (typeof props.radius === "number") parts.push(`border-radius:${props.radius}px;`);
  return parts.join("");
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cssEscape(text) {
  return String(text ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

init();
