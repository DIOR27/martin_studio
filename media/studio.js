const vscode = window.__MARTIN_STUDIO__.vscode;
const assets = (window.__MARTIN_STUDIO__ && window.__MARTIN_STUDIO__.assets) || {};

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
  collapsedGroups: {},
  scrollPositions: {
    sidebar: 0,
    inspector: 0,
    canvas: 0,
    code: 0,
  },
  paletteQuery: "",
  focusState: {
    paletteSearchActive: false,
    paletteSearchStart: 0,
    paletteSearchEnd: 0,
  },
  dragActive: false,
  dragScroll: {
    rafId: 0,
    pointerY: null,
    wheelBound: false,
  },
  collapsedNodes: {},
  inspectorDrafts: {},
};

const STUDIO_STORAGE_KEYS = {
  collapsedPanels: "martin-studio.collapsed-panels",
};

const WIDGET_ICONS = {
  Alert: "!",
  Badge: "●",
  Button: "□",
  Calendar: "31",
  Card: "◫",
  Carousel: "↻",
  Chart: "▤",
  Code: "</>",
  Column: "↕",
  Divider: "—",
  Drawer: "⇥",
  Form: "ƒ",
  Grid: "▦",
  Heading: "H",
  Image: "◩",
  Link: "⤴",
  Map: "⌖",
  Paragraph: "¶",
  Row: "↔",
  Select: "▾",
  SideMenu: "☰",
  Table: "▥",
  Text: "T",
  Timeline: "⋯",
  Video: "▶",
  WordCloud: "☁",
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

const PSEUDO_LEAF_WIDGETS = new Set([
  "Text",
  "Heading",
  "Paragraph",
  "Button",
  "Link",
  "Code",
  "Image",
  "Video",
  "Raw",
  "StyleTag",
  "Stylesheet",
]);

const COMPACT_ROW_WIDGETS = new Set([
  "Raw",
  "SideMenu",
]);

const ICON_VALUE_PRESETS = [
  { value: "↑", label: "Arrow Up" },
  { value: "✆", label: "Phone" },
  { value: "🚀", label: "Rocket" },
  { value: "✨", label: "Sparkles" },
  { value: "⭐", label: "Star" },
  { value: "✅", label: "Check" },
  { value: "⚠️", label: "Warning" },
  { value: "❌", label: "Error" },
  { value: "ℹ️", label: "Info" },
  { value: "🔍", label: "Search" },
  { value: "📅", label: "Calendar" },
  { value: "💬", label: "Chat" },
];

const ICON_PROVIDER_PRESETS = {
  fontawesome: [
    "house", "user", "gear", "bell", "star", "heart", "arrow-up", "arrow-right", "check", "xmark", "bars", "whatsapp",
  ],
  "bootstrap-icons": [
    "house", "person", "gear", "bell", "star", "heart", "arrow-up", "arrow-right", "check", "x-lg", "list", "calendar-event",
  ],
  "material-symbols": [
    "home", "person", "settings", "notifications", "star", "favorite", "arrow_upward", "arrow_forward", "check", "close", "menu", "calendar_month",
  ],
  "material-icons": [
    "home", "person", "settings", "notifications", "star", "favorite", "arrow_upward", "arrow_forward", "check", "close", "menu", "calendar_today",
  ],
  mdi: [
    "home", "account", "cog", "bell", "star", "heart", "arrow-up", "arrow-right", "check", "close", "menu", "calendar-month",
  ],
};

const ICON_PROVIDER_LABELS = {
  none: "Plain",
  fontawesome: "Font Awesome",
  "bootstrap-icons": "Bootstrap Icons",
  "material-symbols": "Material Symbols",
  "material-icons": "Material Icons",
  mdi: "MDI",
  custom: "Custom",
};

function uid(prefix = "node") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildDraftKey(parts) {
  return Object.entries(parts)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}:${String(value)}`)
    .join("|");
}

function getFieldDraftKey(nodeId, propName) {
  return buildDraftKey({ scope: "prop", nodeId, propName });
}

function getCollectionDraftKey(nodeId, propName, index, fieldName, source = "main") {
  return buildDraftKey({ scope: "collection", nodeId, propName, index, fieldName, source });
}

function setInspectorDraft(key, value) {
  if (!key) {
    return;
  }
  state.inspectorDrafts[key] = value;
}

function clearInspectorDraft(key) {
  if (!key) {
    return;
  }
  delete state.inspectorDrafts[key];
}

function readInspectorDraft(key, fallback) {
  return Object.prototype.hasOwnProperty.call(state.inspectorDrafts, key)
    ? state.inspectorDrafts[key]
    : fallback;
}

function loadPersistedUiState() {
  try {
    const rawCollapsed = window.localStorage.getItem(STUDIO_STORAGE_KEYS.collapsedPanels);
    if (!rawCollapsed) {
      return;
    }
    const parsed = JSON.parse(rawCollapsed);
    if (!parsed || typeof parsed !== "object") {
      return;
    }
    for (const panel of Object.keys(state.collapsed)) {
      if (typeof parsed[panel] === "boolean") {
        state.collapsed[panel] = parsed[panel];
      }
    }
  } catch (error) {
    console.warn("Failed to load MARTIN Studio UI state", error);
  }
}

function persistCollapsedPanels() {
  try {
    window.localStorage.setItem(STUDIO_STORAGE_KEYS.collapsedPanels, JSON.stringify(state.collapsed));
  } catch (error) {
    console.warn("Failed to persist MARTIN Studio UI state", error);
  }
}

function init() {
  loadPersistedUiState();
  window.addEventListener("message", onMessage);
  bindDragWheelScroll();
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
    initializeCollapsedNodes();
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
    initializeCollapsedNodes();
    initializeCodeFileSelection();
    render();
    return;
  }
  if (message.type === "projectContextUpdated") {
    state.projectContext = message.payload || null;
    initializeCodeFileSelection();
    render();
    return;
  }
  if (message.type === "assetSelected") {
    if (message.payload && message.payload.nodeId && message.payload.prop) {
      updateProp(message.payload.nodeId, message.payload.prop, message.payload.value);
    }
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
  captureFocusState();
  captureScrollPositions();
  if (!state.catalog || !state.design) {
    document.getElementById("app").innerHTML = `<div class="empty-state">Loading MARTIN Studio...</div>`;
    return;
  }

  document.getElementById("app").innerHTML = `
    <div class="studio-shell ${state.collapsed.palette ? "is-palette-collapsed" : ""} ${state.collapsed.inspector ? "is-inspector-collapsed" : ""} ${state.collapsed.bottom ? "is-bottom-collapsed" : ""}">
      <header class="topbar">
        <div class="brand">
          <img class="brand-mark" src="${escapeHtml(assets.iconUri || "")}" alt="MARTIN">
          <h1>MARTIN Studio</h1>
          <span class="pill">${state.catalog.widget_count} widgets</span>
          ${state.sourceContext ? `<span class="hint">Source: ${escapeHtml(state.sourceContext.relativePath)}</span>` : `<span class="hint">Source: design JSON</span>`}
          ${state.projectContext && state.projectContext.routePath ? `<span class="pill route-pill">Route ${escapeHtml(state.projectContext.routePath)}</span>` : ""}
          ${state.lastSavedTarget ? `<span class="pill">Saved: ${escapeHtml(state.lastSavedTarget)}</span>` : ""}
        </div>
        <div class="topbar-actions">
          ${state.sourceContext ? `<button class="btn" data-action="open-page-source">Open page file</button>` : ""}
          ${state.projectContext && state.projectContext.livePreviewUrl ? `<button class="btn icon-topbar-btn play-btn" data-action="toggle-preview-server" title="${state.projectContext.livePreviewOnline ? "Stop martin run" : "Run martin run"}" aria-label="${state.projectContext.livePreviewOnline ? "Stop martin run" : "Run martin run"}">${state.projectContext.livePreviewOnline ? "■" : "▶"}</button>` : ""}
          ${state.projectContext && state.projectContext.livePreviewUrl ? `<button class="btn icon-topbar-btn" data-action="open-browser-preview" title="Open preview in browser tab" aria-label="Open preview in browser tab">🌐</button>` : ""}
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
  bindGroupActions();
  bindPaletteSearch();
  restoreScrollPositions();
  restoreFocusState();
}

function renderPalette() {
  const groups = new Map();
  const query = state.paletteQuery.trim().toLowerCase();
  const isSearching = Boolean(query);
  for (const widget of state.catalog.widgets) {
    const haystack = [widget.name, widget.category, widget.summary || ""].join(" ").toLowerCase();
    if (query && !haystack.includes(query)) {
      continue;
    }
    if (!groups.has(widget.category)) {
      groups.set(widget.category, []);
    }
    groups.get(widget.category).push(widget);
  }

  return `
    <div class="palette-sticky">
      <div class="panel-head">
        <p class="section-title">Palette</p>
        <button class="icon-btn panel-toggle" data-action="toggle-panel" data-panel="palette" title="${state.collapsed.palette ? "Expand palette" : "Collapse palette"}">${state.collapsed.palette ? "▸" : "◂"}</button>
      </div>
      <div class="palette-search">
        <input
          type="text"
          class="palette-search-input"
          data-role="palette-search"
          placeholder="Search widgets"
          value="${escapeHtml(state.paletteQuery)}"
        >
      </div>
    </div>
    ${groups.size ? "" : `<div class="empty-state">No widgets match your search.</div>`}
    ${Array.from(groups.entries()).map(([category, widgets]) => {
      const collapsed = isSearching ? false : Boolean(state.collapsedGroups[category]);
      return `
      <section class="catalog-group ${collapsed ? "is-collapsed" : ""}">
        <button class="catalog-group-toggle" data-action="toggle-group" data-group="${escapeHtml(category)}" title="${collapsed ? "Expand group" : "Collapse group"}">
          <span>${escapeHtml(category)}</span>
          <span class="catalog-group-caret">${collapsed ? "▸" : "▾"}</span>
        </button>
        ${collapsed ? "" : widgets.map((widget) => `
          <button class="palette-item" draggable="true" data-widget="${escapeHtml(widget.name)}" title="${escapeHtml(widget.summary || widget.name)}">
            <span class="widget-icon">${escapeHtml(getWidgetIcon(widget.name))}</span>
            <span class="palette-copy">
              <span class="palette-name">${escapeHtml(widget.name)}</span>
              <small>${escapeHtml(widget.summary || widget.category)}</small>
            </span>
          </button>
        `).join("")}
      </section>
    `;
    }).join("")}
  `;
}

function renderCanvas() {
  return renderNode(state.design.root, true);
}

function renderNode(node, isRoot = false) {
  const widget = getWidget(node.type);
  const selected = state.selectedId === node.id ? "is-selected" : "";
  const children = Array.isArray(node.children) ? node.children : [];
  const canReceiveChildren = Boolean(widget && widget.accepts_children && (!PSEUDO_LEAF_WIDGETS.has(node.type) || children.length));
  const isCollapsed = canReceiveChildren && !isRoot && Boolean(state.collapsedNodes[node.id]);
  const isRow = node.type === "Row";
  const isCompactRowWidget = COMPACT_ROW_WIDGETS.has(node.type);
  const compactRowChildren = isRow ? children.filter((child) => COMPACT_ROW_WIDGETS.has(child.type)) : [];
  const regularRowChildren = isRow ? children.filter((child) => !COMPACT_ROW_WIDGETS.has(child.type)) : children;
  const childrenClass = isRow ? "node-children is-row" : "node-children";
  const compactChildrenMarkup = !isCollapsed && isRow && compactRowChildren.length
    ? `
        <div class="node-children-compact">
          ${compactRowChildren.map((child) => `
            <div class="node-child-slot node-child-slot-compact">
              ${renderNode(child)}
            </div>
          `).join("")}
        </div>
      `
    : "";
  const childrenMarkup = canReceiveChildren && !isCollapsed
    ? isRow
      ? regularRowChildren.map((child) => `
          <div class="node-child-slot node-child-slot-row ${COMPACT_ROW_WIDGETS.has(child.type) ? "is-compact-row-item" : ""}">
            ${renderNode(child)}
          </div>
        `).join("")
      : children.map((child, index) => `
          <div class="node-child-slot">
            <div class="dropzone dropzone-inline" data-drop-parent="${escapeHtml(node.id)}" data-drop-index="${index}">+</div>
            ${renderNode(child)}
          </div>
        `).join("")
    : "";

  return `
    <article class="node-card ${selected} ${!isRoot ? "is-draggable" : ""} ${isCompactRowWidget ? "is-compact-row-widget" : ""}" data-node-id="${escapeHtml(node.id)}" ${!isRoot ? `draggable="true"` : ""}>
      <div class="node-head">
        <div>
          <div class="node-title">${escapeHtml(node.type)}</div>
          <div class="node-meta">${escapeHtml(summarizeNode(node))}</div>
        </div>
        <div class="node-actions">
          ${canReceiveChildren && !isRoot ? `<button class="icon-btn icon-btn-square" data-action="toggle-node-collapse" data-node-id="${escapeHtml(node.id)}" title="${isCollapsed ? "Expand widget" : "Collapse widget"}" aria-label="${isCollapsed ? "Expand widget" : "Collapse widget"}">${isCollapsed ? "▸" : "▾"}</button>` : ""}
          ${!isRoot ? `<button class="icon-btn icon-btn-square" data-action="duplicate-node" data-node-id="${escapeHtml(node.id)}" title="Duplicate widget" aria-label="Duplicate widget">⧉</button>` : ""}
          ${!isRoot ? `<button class="icon-btn icon-btn-square" data-action="delete-node" data-node-id="${escapeHtml(node.id)}" title="Delete widget" aria-label="Delete widget">✕</button>` : ""}
        </div>
      </div>
      ${canReceiveChildren ? (isCollapsed
        ? `<div class="hint">Collapsed · ${countDescendants(node)} nested widgets</div>`
        : `
        ${compactChildrenMarkup}
        <div class="${childrenClass}">
          ${childrenMarkup}
          <div class="node-child-slot ${isRow ? "node-child-slot-row-drop is-tail" : "node-child-slot-tail"}"><div class="dropzone ${isRow ? "dropzone-row-side" : "dropzone-tail"}" data-drop-parent="${escapeHtml(node.id)}" data-drop-index="${children.length}">+</div></div>
        </div>
      `) : `<div class="hint">Leaf widget</div>`}
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
      <button class="icon-btn panel-toggle" data-action="toggle-panel" data-panel="inspector" title="${state.collapsed.inspector ? "Expand inspector" : "Collapse inspector"}">${state.collapsed.inspector ? "◂" : "▸"}</button>
    </div>
    <h2 style="margin:0 0 8px">${escapeHtml(node.type)}</h2>
    <p class="hint" style="margin:0 0 16px">${escapeHtml(widget.summary || "")}</p>
    <div class="props-grid">
      ${editableParams.map((param) => renderField(node, widget, param)).join("")}
    </div>
  `;
}

function renderNumberEditor({
  fieldId,
  value,
  inputType,
  extraAttributes = "",
  actionName,
  stepActionAttrs,
}) {
  return `
    <div class="number-input-wrap">
      <input type="${escapeHtml(inputType)}" id="${escapeHtml(fieldId)}" value="${escapeHtml(value)}" ${extraAttributes}>
      <div class="number-stepper" aria-hidden="true">
        <button type="button" class="number-step-btn" data-editor-action="${escapeHtml(actionName)}" data-step-direction="up" ${stepActionAttrs}>+</button>
        <button type="button" class="number-step-btn" data-editor-action="${escapeHtml(actionName)}" data-step-direction="down" ${stepActionAttrs}>-</button>
      </div>
    </div>
  `;
}

function getIconProviderValue(node, widget) {
  const raw = getNodeParamValue(node, widget, "provider");
  if (raw === null || raw === undefined || raw === "") {
    return "none";
  }
  return String(raw);
}

function parseIconWidgetState(value) {
  if (value && typeof value === "object" && !Array.isArray(value) && value.__martin_expr__ === "IconWidget") {
    const provider = value.provider ? String(value.provider) : "none";
    return {
      mode: provider === "none" ? "plain" : provider,
      plainValue: value.icon || "",
      providerValue: provider,
      nameValue: value.name || "",
      customProvider: provider && !Object.prototype.hasOwnProperty.call(ICON_PROVIDER_LABELS, provider) ? provider : "",
      size: value.size,
      variant: value.variant || "",
    };
  }
  return {
    mode: "plain",
    plainValue: value === null || value === undefined ? "" : String(value),
    providerValue: "none",
    nameValue: "",
    customProvider: "",
    size: "",
    variant: "",
  };
}

function getIconWidgetDraftKey(nodeId, propName) {
  return buildDraftKey({ scope: "icon-widget", nodeId, propName });
}

function renderIconValueEditor(node, fieldId, propName, value) {
  const currentValue = value === null || value === undefined ? "" : String(value);
  return `
    <div class="icon-value-editor">
      <div class="icon-chip-grid">
        ${ICON_VALUE_PRESETS.map((preset) => `
          <button
            type="button"
            class="icon-chip ${currentValue === preset.value ? "is-active" : ""}"
            data-editor-action="pick-icon-value"
            data-node-id="${escapeHtml(node.id)}"
            data-prop="${escapeHtml(propName)}"
            data-icon-value="${escapeHtml(preset.value)}"
            title="${escapeHtml(preset.label)}"
          >
            <span class="icon-chip-glyph">${escapeHtml(preset.value)}</span>
          </button>
        `).join("")}
      </div>
      <input
        type="text"
        id="${escapeHtml(fieldId)}"
        value="${escapeHtml(currentValue)}"
        placeholder="Custom icon or emoji"
        data-node-id="${escapeHtml(node.id)}"
        data-prop="${escapeHtml(propName)}"
        data-field-type="string"
      >
    </div>
  `;
}

function renderIconProviderEditor(node, fieldId, propName, value, param) {
  const options = Array.isArray(param.editor?.options) ? param.editor.options : [];
  const currentValue = value === null || value === undefined || value === "" ? "none" : String(value);
  const selectValue = options.includes(currentValue) ? currentValue : "custom";
  const customValue = selectValue === "custom" ? currentValue : "";
  return `
    <div class="icon-provider-editor">
      <select
        id="${escapeHtml(fieldId)}"
        data-editor-kind="icon-provider-select"
        data-node-id="${escapeHtml(node.id)}"
        data-prop="${escapeHtml(propName)}"
      >
        ${options.map((option) => `
          <option value="${escapeHtml(option)}" ${selectValue === option ? "selected" : ""}>${escapeHtml(ICON_PROVIDER_LABELS[option] || option)}</option>
        `).join("")}
      </select>
      ${selectValue === "custom" ? `
        <input
          type="text"
          value="${escapeHtml(customValue)}"
          placeholder="boxicons, remixicon..."
          data-editor-kind="icon-provider-custom"
          data-node-id="${escapeHtml(node.id)}"
          data-prop="${escapeHtml(propName)}"
        >
      ` : ""}
    </div>
  `;
}

function renderIconWidgetEditor(node, fieldId, propName, value) {
  const draftValue = readInspectorDraft(getIconWidgetDraftKey(node.id, propName), value);
  const state = parseIconWidgetState(draftValue);
  const provider = state.mode;
  const presets = ICON_PROVIDER_PRESETS[provider] || [];
  return `
    <div
      class="icon-widget-editor"
      data-editor-kind="icon-widget-root"
      data-node-id="${escapeHtml(node.id)}"
      data-prop="${escapeHtml(propName)}"
    >
      <select data-editor-kind="icon-widget-mode" data-node-id="${escapeHtml(node.id)}" data-prop="${escapeHtml(propName)}">
        <option value="plain" ${provider === "plain" ? "selected" : ""}>Plain</option>
        <option value="fontawesome" ${provider === "fontawesome" ? "selected" : ""}>Font Awesome</option>
        <option value="bootstrap-icons" ${provider === "bootstrap-icons" ? "selected" : ""}>Bootstrap Icons</option>
        <option value="material-symbols" ${provider === "material-symbols" ? "selected" : ""}>Material Symbols</option>
        <option value="material-icons" ${provider === "material-icons" ? "selected" : ""}>Material Icons</option>
        <option value="mdi" ${provider === "mdi" ? "selected" : ""}>MDI</option>
        <option value="custom-provider" ${provider !== "plain" && provider !== "fontawesome" && provider !== "bootstrap-icons" && provider !== "material-symbols" && provider !== "material-icons" && provider !== "mdi" ? "selected" : ""}>Custom provider</option>
      </select>
      ${provider === "plain" ? `
        ${renderIconValueEditor(node, fieldId, propName, state.plainValue)}
      ` : `
        ${provider === "custom-provider" ? `
          <input
            type="text"
            value="${escapeHtml(state.customProvider)}"
            placeholder="Provider"
            data-editor-kind="icon-widget-provider-custom"
            data-node-id="${escapeHtml(node.id)}"
            data-prop="${escapeHtml(propName)}"
          >
        ` : ""}
        ${presets.length ? `
          <div class="icon-chip-grid icon-chip-grid-names">
            ${presets.map((preset) => `
              <button
                type="button"
                class="icon-chip icon-chip-name ${state.nameValue === preset ? "is-active" : ""}"
                data-editor-action="pick-icon-widget-name"
                data-node-id="${escapeHtml(node.id)}"
                data-prop="${escapeHtml(propName)}"
                data-icon-name="${escapeHtml(preset)}"
                title="${escapeHtml(preset)}"
              >
                <span class="icon-chip-label">${escapeHtml(preset)}</span>
              </button>
            `).join("")}
          </div>
        ` : ""}
        <input
          type="text"
          value="${escapeHtml(state.nameValue)}"
          placeholder="Icon name"
          data-editor-kind="icon-widget-name"
          data-node-id="${escapeHtml(node.id)}"
          data-prop="${escapeHtml(propName)}"
        >
      `}
    </div>
  `;
}

function renderIconNameEditor(node, widget, fieldId, propName, value) {
  const currentValue = value === null || value === undefined ? "" : String(value);
  const provider = getIconProviderValue(node, widget);
  const presets = ICON_PROVIDER_PRESETS[provider] || [];
  return `
    <div class="icon-name-editor">
      ${presets.length ? `
        <div class="icon-chip-grid icon-chip-grid-names">
          ${presets.map((preset) => `
            <button
              type="button"
              class="icon-chip icon-chip-name ${currentValue === preset ? "is-active" : ""}"
              data-editor-action="pick-icon-name"
              data-node-id="${escapeHtml(node.id)}"
              data-prop="${escapeHtml(propName)}"
              data-icon-name="${escapeHtml(preset)}"
              title="${escapeHtml(preset)}"
            >
              <span class="icon-chip-label">${escapeHtml(preset)}</span>
            </button>
          `).join("")}
        </div>
      ` : ""}
      <input
        type="text"
        id="${escapeHtml(fieldId)}"
        value="${escapeHtml(currentValue)}"
        placeholder="${escapeHtml(provider === "none" ? "star, rocket, emoji..." : "Icon name")}"
        data-node-id="${escapeHtml(node.id)}"
        data-prop="${escapeHtml(propName)}"
        data-field-type="string"
      >
    </div>
  `;
}

function parseConditionState(value) {
  if (typeof value === "boolean") {
    return { mode: "static", staticValue: value, fieldId: "", source: "auto", operator: "==", compareValue: "" };
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (value.__martin_expr__ === "ConditionDraft") {
      return {
        mode: value.mode || "static",
        staticValue: value.staticValue !== false,
        fieldId: value.fieldId || "",
        source: value.source || "auto",
        operator: value.operator || "==",
        compareValue: value.compareValue === null || value.compareValue === undefined ? "" : String(value.compareValue),
      };
    }
    if (value.__martin_expr__ === "Field") {
      return {
        mode: "field",
        staticValue: true,
        fieldId: value.input_id || "",
        source: value.source || "auto",
        operator: "truthy",
        compareValue: "",
      };
    }
    if (value.__martin_expr__ === "Condition" && value.left && value.left.__martin_expr__ === "Field") {
      return {
        mode: "field",
        staticValue: true,
        fieldId: value.left.input_id || "",
        source: value.left.source || "auto",
        operator: value.operator || "==",
        compareValue: value.right === null || value.right === undefined ? "" : String(value.right),
      };
    }
  }
  return { mode: "static", staticValue: true, fieldId: "", source: "auto", operator: "==", compareValue: "" };
}

function renderConditionEditor(node, fieldId, propName, value) {
  const stateValue = parseConditionState(value);
  const enabled = value !== null && value !== undefined;
  const compareVisible = !["truthy", "falsy"].includes(stateValue.operator);
  return `
    <div class="condition-editor" data-editor-kind="condition-root" data-node-id="${escapeHtml(node.id)}" data-prop="${escapeHtml(propName)}">
      <label class="inspector-check inspector-check-inline condition-toggle ${enabled ? "is-on" : ""}">
        <input type="checkbox" data-editor-kind="condition-enabled" data-node-id="${escapeHtml(node.id)}" data-prop="${escapeHtml(propName)}" ${enabled ? "checked" : ""}>
        <span class="inspector-check-box" aria-hidden="true"></span>
        <span class="inspector-check-copy">
          <span class="inspector-check-title-row">
            <strong>Enable ${escapeHtml(propName)}</strong>
          </span>
          <small>Show editor for this rule.</small>
        </span>
      </label>
      ${enabled ? `
        <div class="condition-editor-body">
          <select id="${escapeHtml(fieldId)}" data-editor-kind="condition-mode" data-node-id="${escapeHtml(node.id)}" data-prop="${escapeHtml(propName)}">
            <option value="static" ${stateValue.mode === "static" ? "selected" : ""}>Static value</option>
            <option value="field" ${stateValue.mode === "field" ? "selected" : ""}>Depends on another widget</option>
          </select>
          ${stateValue.mode === "static" ? `
            <select data-editor-kind="condition-static-select" data-node-id="${escapeHtml(node.id)}" data-prop="${escapeHtml(propName)}">
              <option value="true" ${stateValue.staticValue ? "selected" : ""}>True</option>
              <option value="false" ${!stateValue.staticValue ? "selected" : ""}>False</option>
            </select>
          ` : `
            <input type="text" value="${escapeHtml(stateValue.fieldId)}" placeholder="Widget id" data-editor-kind="condition-field-id" data-node-id="${escapeHtml(node.id)}" data-prop="${escapeHtml(propName)}">
            <select data-editor-kind="condition-source" data-node-id="${escapeHtml(node.id)}" data-prop="${escapeHtml(propName)}">
              <option value="auto" ${stateValue.source === "auto" ? "selected" : ""}>Auto</option>
              <option value="value" ${stateValue.source === "value" ? "selected" : ""}>Value</option>
              <option value="checked" ${stateValue.source === "checked" ? "selected" : ""}>Checked</option>
              <option value="text" ${stateValue.source === "text" ? "selected" : ""}>Text</option>
            </select>
            <select data-editor-kind="condition-operator" data-node-id="${escapeHtml(node.id)}" data-prop="${escapeHtml(propName)}">
              <option value="truthy" ${stateValue.operator === "truthy" ? "selected" : ""}>Has value</option>
              <option value="falsy" ${stateValue.operator === "falsy" ? "selected" : ""}>No value</option>
              <option value="==" ${stateValue.operator === "==" ? "selected" : ""}>Equals</option>
              <option value="!=" ${stateValue.operator === "!=" ? "selected" : ""}>Not equal</option>
              <option value=">" ${stateValue.operator === ">" ? "selected" : ""}>Greater than</option>
              <option value=">=" ${stateValue.operator === ">=" ? "selected" : ""}>Greater or equal</option>
              <option value="<" ${stateValue.operator === "<" ? "selected" : ""}>Less than</option>
              <option value="<=" ${stateValue.operator === "<=" ? "selected" : ""}>Less or equal</option>
              <option value="contains" ${stateValue.operator === "contains" ? "selected" : ""}>Contains</option>
            </select>
            ${compareVisible ? `<input type="text" value="${escapeHtml(stateValue.compareValue)}" placeholder="Compare with" data-editor-kind="condition-value" data-node-id="${escapeHtml(node.id)}" data-prop="${escapeHtml(propName)}">` : ""}
          `}
        </div>
      ` : ""}
    </div>
  `;
}

function getNodeParamValue(node, widget, paramName) {
  if (node?.props && Object.prototype.hasOwnProperty.call(node.props, paramName)) {
    return node.props[paramName];
  }
  if (widget?.preset_props && Object.prototype.hasOwnProperty.call(widget.preset_props, paramName)) {
    return widget.preset_props[paramName];
  }
  const param = getWidgetParam(widget, paramName);
  return param ? param.default : undefined;
}

function highlightCodeHtml(source, language) {
  const escaped = escapeHtml(source || "");
  const lang = String(language || "").toLowerCase();

  if (lang === "html") {
    return escaped
      .replace(/(&lt;\/?)([a-zA-Z][\w:-]*)/g, '$1<span class="tok-keyword">$2</span>')
      .replace(/([a-zA-Z-:]+)=(&quot;.*?&quot;|&#39;.*?&#39;)/g, '<span class="tok-property">$1</span>=<span class="tok-string">$2</span>')
      .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="tok-comment">$1</span>');
  }

  if (lang === "json") {
    return escaped
      .replace(/(&quot;[^&]*&quot;)(\s*:)/g, '<span class="tok-property">$1</span>$2')
      .replace(/(:\s*)(&quot;.*?&quot;)/g, '$1<span class="tok-string">$2</span>')
      .replace(/\b(true|false|null)\b/g, '<span class="tok-keyword">$1</span>')
      .replace(/\b(-?\d+(\.\d+)?)\b/g, '<span class="tok-number">$1</span>');
  }

  if (lang === "css") {
    return escaped
      .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="tok-comment">$1</span>')
      .replace(/([.#]?[a-zA-Z_][\w\-.:#\s>+]*)\s*\{/g, '<span class="tok-keyword">$1</span>{')
      .replace(/([a-z-]+)(\s*:)/gi, '<span class="tok-property">$1</span>$2')
      .replace(/(&quot;.*?&quot;|&#39;.*?&#39;)/g, '<span class="tok-string">$1</span>')
      .replace(/\b(\d+(\.\d+)?)\b/g, '<span class="tok-number">$1</span>');
  }

  if (lang === "javascript" || lang === "js" || lang === "ts" || lang === "typescript") {
    return escaped
      .replace(/(\/\/.*?$|\/\*[\s\S]*?\*\/)/gm, '<span class="tok-comment">$1</span>')
      .replace(/(&quot;.*?&quot;|&#39;.*?&#39;|`[\s\S]*?`)/g, '<span class="tok-string">$1</span>')
      .replace(/\b(function|return|const|let|var|if|else|for|while|class|new|import|from|export|default|async|await|try|catch|throw|true|false|null|undefined)\b/g, '<span class="tok-keyword">$1</span>')
      .replace(/\b(\d+(\.\d+)?)\b/g, '<span class="tok-number">$1</span>');
  }

  if (lang === "bash" || lang === "shell" || lang === "sh" || lang === "zsh") {
    return escaped
      .replace(/(#.*?$)/gm, '<span class="tok-comment">$1</span>')
      .replace(/(&quot;.*?&quot;|&#39;.*?&#39;)/g, '<span class="tok-string">$1</span>')
      .replace(/\b(if|then|else|fi|for|do|done|while|case|esac|function|in|echo|export|alias|sudo|cd|ls|cat|grep|find|curl|wget|git|python|node|npm)\b/g, '<span class="tok-keyword">$1</span>')
      .replace(/\$\w+/g, '<span class="tok-property">$&</span>');
  }

  if (lang === "powershell" || lang === "pwsh" || lang === "ps1") {
    return escaped
      .replace(/(#.*?$)/gm, '<span class="tok-comment">$1</span>')
      .replace(/(&quot;.*?&quot;|&#39;.*?&#39;)/g, '<span class="tok-string">$1</span>')
      .replace(/\b(function|param|if|else|elseif|foreach|for|while|switch|return|try|catch|finally|throw)\b/gi, '<span class="tok-keyword">$1</span>')
      .replace(/-[A-Za-z][\w-]*/g, '<span class="tok-property">$&</span>')
      .replace(/\$\w[\w:]*/g, '<span class="tok-number">$&</span>');
  }

  if (lang === "custom") {
    return escaped;
  }

  if (lang === "python" || lang === "py" || !lang) {
    return escaped
    .replace(/(#.*?$)/gm, '<span class="tok-comment">$1</span>')
    .replace(/(&quot;.*?&quot;|&#39;.*?&#39;)/g, '<span class="tok-string">$1</span>')
    .replace(/\b(def|class|return|if|elif|else|for|while|in|import|from|as|try|except|finally|with|lambda|yield|pass|break|continue|True|False|None|and|or|not)\b/g, '<span class="tok-keyword">$1</span>')
    .replace(/\b(self)\b/g, '<span class="tok-property">$1</span>')
    .replace(/\b(\d+(\.\d+)?)\b/g, '<span class="tok-number">$1</span>');
  }

  return escaped;
}

function renderField(node, widget, param) {
  const current = node.props && Object.prototype.hasOwnProperty.call(node.props, param.name)
    ? node.props[param.name]
    : (widget.preset_props && Object.prototype.hasOwnProperty.call(widget.preset_props, param.name)
      ? widget.preset_props[param.name]
      : param.default);
  const draftKey = getFieldDraftKey(node.id, param.name);
  const draftCurrent = readInspectorDraft(draftKey, current);
  const fieldId = `${node.id}_${param.name}`;
  const common = `data-node-id="${escapeHtml(node.id)}" data-prop="${escapeHtml(param.name)}"`;

  if ((node.type === "Image" || node.type === "Video") && param.name === "src") {
    const value = draftCurrent === null || draftCurrent === undefined ? "" : String(draftCurrent);
    return `
      <div class="field">
        <label for="${escapeHtml(fieldId)}">${escapeHtml(param.name)}</label>
        <div class="asset-picker">
          <input type="text" id="${escapeHtml(fieldId)}" value="${escapeHtml(value)}" ${common} data-field-type="${escapeHtml(param.type)}">
          <button
            type="button"
            class="mini-btn"
            data-editor-action="browse-asset"
            data-node-id="${escapeHtml(node.id)}"
            data-prop="${escapeHtml(param.name)}"
            data-media-kind="${node.type === "Video" ? "video" : "image"}"
          >Browse</button>
        </div>
      </div>
    `;
  }

  if (node.type === "Code" && param.name === "content") {
    const value = draftCurrent === null || draftCurrent === undefined ? "" : String(draftCurrent);
    const language = String(getNodeParamValue(node, widget, "language") || "python");
    return `
      <div class="field code-editor-field">
        <label for="${escapeHtml(fieldId)}">${escapeHtml(param.name)}</label>
        <div class="code-editor-surface">
          <pre class="code-editor-highlight" aria-hidden="true" data-code-highlight="${escapeHtml(node.id)}_${escapeHtml(param.name)}">${highlightCodeHtml(value, language)}\n</pre>
          <textarea
            id="${escapeHtml(fieldId)}"
            class="code-editor-input"
            ${common}
            data-field-type="${escapeHtml(param.type)}"
            data-code-language="${escapeHtml(language)}"
            data-code-highlight="${escapeHtml(node.id)}_${escapeHtml(param.name)}"
            spellcheck="false"
            autocapitalize="off"
            autocomplete="off"
            autocorrect="off"
          >${escapeHtml(value)}</textarea>
        </div>
      </div>
    `;
  }

  if (node.type === "Code" && param.name === "language" && param.editor && param.editor.type === "code_language") {
    const options = Array.isArray(param.editor.options) ? param.editor.options : [];
    const currentValue = draftCurrent === null || draftCurrent === undefined ? "" : String(draftCurrent);
    const selectValue = options.includes(currentValue) ? currentValue : "custom";
    const customValue = selectValue === "custom" ? currentValue.replace(/^custom$/i, "") : "";
    return `
      <div class="field">
        <label for="${escapeHtml(fieldId)}">${escapeHtml(param.name)}</label>
        <div class="code-language-editor">
          <select
            id="${escapeHtml(fieldId)}"
            data-editor-kind="code-language-select"
            data-node-id="${escapeHtml(node.id)}"
            data-prop="${escapeHtml(param.name)}"
          >
            ${options.map((option) => `
              <option value="${escapeHtml(String(option))}" ${selectValue === String(option) ? "selected" : ""}>${escapeHtml(String(option))}</option>
            `).join("")}
          </select>
          ${selectValue === "custom" ? `
            <input
              type="text"
              value="${escapeHtml(customValue)}"
              placeholder="yaml, sql, xml..."
              data-editor-kind="code-language-custom"
              data-node-id="${escapeHtml(node.id)}"
              data-prop="${escapeHtml(param.name)}"
            >
          ` : ""}
        </div>
      </div>
    `;
  }

  if (param.editor && param.editor.type === "icon_widget") {
    return `
      <div class="field">
        <label for="${escapeHtml(fieldId)}">${escapeHtml(param.name)}</label>
        ${renderIconWidgetEditor(node, fieldId, param.name, draftCurrent)}
      </div>
    `;
  }

  if (param.editor && param.editor.type === "icon_value") {
    const value = draftCurrent === null || draftCurrent === undefined ? "" : String(draftCurrent);
    return `
      <div class="field">
        <label for="${escapeHtml(fieldId)}">${escapeHtml(param.name)}</label>
        ${renderIconValueEditor(node, fieldId, param.name, value)}
      </div>
    `;
  }

  if (node.type === "Icon" && param.name === "provider" && param.editor && param.editor.type === "icon_provider") {
    return `
      <div class="field">
        <label for="${escapeHtml(fieldId)}">${escapeHtml(param.name)}</label>
        ${renderIconProviderEditor(node, fieldId, param.name, draftCurrent, param)}
      </div>
    `;
  }

  if (node.type === "Icon" && param.name === "name" && param.editor && param.editor.type === "icon_name") {
    return `
      <div class="field">
        <label for="${escapeHtml(fieldId)}">${escapeHtml(param.name)}</label>
        ${renderIconNameEditor(node, widget, fieldId, param.name, draftCurrent)}
      </div>
    `;
  }

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

  if (param.editor && param.editor.type === "condition") {
    const hasExplicitValue = node.props && Object.prototype.hasOwnProperty.call(node.props, param.name);
    const actualValue = hasExplicitValue ? node.props[param.name] : null;
    const draftCondition = readInspectorDraft(draftKey, actualValue);
    return `
      <div class="field">
        <label for="${escapeHtml(fieldId)}">${escapeHtml(param.name)}</label>
        ${renderConditionEditor(node, fieldId, param.name, draftCondition)}
      </div>
    `;
  }

  if (param.type === "boolean") {
    return `
      <div class="field">
        <label for="${escapeHtml(fieldId)}">${escapeHtml(param.name)}</label>
        <label class="inspector-check inspector-check-inline ${draftCurrent ? "is-on" : ""}" for="${escapeHtml(fieldId)}">
          <input type="checkbox" id="${escapeHtml(fieldId)}" ${common} data-field-type="boolean" ${draftCurrent ? "checked" : ""}>
          <span class="inspector-check-box" aria-hidden="true"></span>
          <span class="inspector-check-copy">
            <span class="inspector-check-title-row">
              <strong>${draftCurrent ? "Enabled" : "Disabled"}</strong>
            </span>
            <small>${escapeHtml(param.name)} ${draftCurrent ? "is active" : "is inactive"}</small>
          </span>
        </label>
      </div>
    `;
  }

  if (param.type === "enum") {
    return `
      <div class="field">
        <label for="${escapeHtml(fieldId)}">${escapeHtml(param.name)}</label>
        <select id="${escapeHtml(fieldId)}" ${common} data-field-type="enum">
          ${param.options.map((option) => `
            <option value="${escapeHtml(String(option))}" ${String(draftCurrent ?? "") === String(option) ? "selected" : ""}>${escapeHtml(String(option))}</option>
          `).join("")}
        </select>
      </div>
    `;
  }

  if (param.type === "array" || param.type === "object") {
    return `
      <div class="field">
        <label for="${escapeHtml(fieldId)}">${escapeHtml(param.name)}</label>
        <textarea id="${escapeHtml(fieldId)}" ${common} data-field-type="${escapeHtml(param.type)}">${escapeHtml(draftCurrent ? JSON.stringify(draftCurrent, null, 2) : "")}</textarea>
      </div>
    `;
  }

  const inputType = param.type === "integer" || param.type === "float" ? "number" : "text";
  const value = draftCurrent === null || draftCurrent === undefined ? "" : String(draftCurrent);
  if (param.type === "integer" || param.type === "float") {
    return `
      <div class="field">
        <label for="${escapeHtml(fieldId)}">${escapeHtml(param.name)}</label>
        ${renderNumberEditor({
          fieldId,
          value,
          inputType,
          extraAttributes: `${common} data-field-type="${escapeHtml(param.type)}"`,
          actionName: "step-number-field",
          stepActionAttrs: `data-node-id="${escapeHtml(node.id)}" data-prop="${escapeHtml(param.name)}" data-field-type="${escapeHtml(param.type)}"`,
        })}
      </div>
    `;
  }
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
  const draftKey = getCollectionDraftKey(node.id, param.name, index, field.name);
  const draftCurrent = readInspectorDraft(draftKey, current);
  const common = `
    data-editor-kind="collection-field"
    data-node-id="${escapeHtml(node.id)}"
    data-prop="${escapeHtml(param.name)}"
    data-index="${index}"
    data-item-field="${escapeHtml(field.name)}"
    data-item-type="${escapeHtml(field.type || "string")}"
  `;
  const inputType = editorInputType(field.type);
  let control = "";
  if (field.type === "boolean") {
    control = `
      <input
        type="checkbox"
        id="${escapeHtml(fieldId)}"
        ${common}
        ${draftCurrent ? "checked" : ""}
      >
    `;
  } else if (field.type === "date") {
    const dateText = draftCurrent === null || draftCurrent === undefined ? "" : String(draftCurrent);
    control = `
      <div class="date-input-pair">
        <input
          type="text"
          id="${escapeHtml(fieldId)}"
          value="${escapeHtml(dateText)}"
          placeholder="YYYY-MM-DD"
          ${common}
          data-date-source="text"
        >
        <input
          type="date"
          value="${escapeHtml(dateText)}"
          ${common}
          data-date-source="picker"
          aria-label="${escapeHtml(field.label || field.name)} picker"
        >
      </div>
    `;
  } else if (field.multiline) {
    control = `
      <textarea
        id="${escapeHtml(fieldId)}"
        ${common}
      >${escapeHtml(draftCurrent ?? "")}</textarea>
    `;
  } else {
    if (field.type === "integer" || field.type === "float") {
      const numericValue = draftCurrent === null || draftCurrent === undefined ? "" : String(draftCurrent);
      control = renderNumberEditor({
        fieldId,
        value: numericValue,
        inputType,
        extraAttributes: `${common}`,
        actionName: "step-collection-number-field",
        stepActionAttrs: `
          data-node-id="${escapeHtml(node.id)}"
          data-prop="${escapeHtml(param.name)}"
          data-index="${index}"
          data-item-field="${escapeHtml(field.name)}"
          data-item-type="${escapeHtml(field.type || "string")}"
        `,
      });
    } else {
    control = `
      <input
        type="${escapeHtml(inputType)}"
        id="${escapeHtml(fieldId)}"
        value="${escapeHtml(draftCurrent ?? "")}"
        ${common}
      >
    `;
    }
  }
  return `
    <div class="field compact">
      <label for="${escapeHtml(fieldId)}">${escapeHtml(field.label || field.name)}</label>
      ${control}
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

function bindGroupActions() {
  document.querySelectorAll('[data-action="toggle-group"]').forEach((button) => {
    button.addEventListener("click", () => toggleGroup(button.dataset.group));
  });
}

function setDragActive(active) {
  state.dragActive = Boolean(active);
  const shell = document.querySelector(".studio-shell");
  if (shell) {
    shell.classList.toggle("is-drag-active", state.dragActive);
  }
  if (state.dragActive) {
    ensureDragAutoScroll();
  } else {
    stopDragAutoScroll();
  }
}

function updateDragPointer(event) {
  state.dragScroll.pointerY = typeof event?.clientY === "number" ? event.clientY : null;
}

function ensureDragAutoScroll() {
  if (state.dragScroll.rafId) {
    return;
  }
  const tick = () => {
    state.dragScroll.rafId = 0;
    if (!state.dragActive) {
      return;
    }
    const canvas = document.querySelector(".canvas-wrap");
    const pointerY = state.dragScroll.pointerY;
    if (canvas && typeof pointerY === "number") {
      const rect = canvas.getBoundingClientRect();
      const threshold = Math.min(96, Math.max(48, rect.height * 0.14));
      let delta = 0;
      if (pointerY < rect.top + threshold) {
        const intensity = 1 - Math.max(0, (pointerY - rect.top) / threshold);
        delta = -Math.ceil(8 + intensity * 24);
      } else if (pointerY > rect.bottom - threshold) {
        const intensity = 1 - Math.max(0, (rect.bottom - pointerY) / threshold);
        delta = Math.ceil(8 + intensity * 24);
      }
      if (delta !== 0) {
        canvas.scrollTop += delta;
      }
    }
    ensureDragAutoScroll();
  };
  state.dragScroll.rafId = requestAnimationFrame(tick);
}

function stopDragAutoScroll() {
  if (state.dragScroll.rafId) {
    cancelAnimationFrame(state.dragScroll.rafId);
    state.dragScroll.rafId = 0;
  }
  state.dragScroll.pointerY = null;
}

function bindDragWheelScroll() {
  if (state.dragScroll.wheelBound) {
    return;
  }
  state.dragScroll.wheelBound = true;
  const handleWheel = (event) => {
    if (!state.dragActive) {
      return;
    }
    const canvas = document.querySelector(".canvas-wrap");
    if (!canvas) {
      return;
    }
    const deltaY = typeof event.deltaY === "number"
      ? event.deltaY
      : (typeof event.wheelDelta === "number" ? -event.wheelDelta : 0);
    const deltaX = typeof event.deltaX === "number" ? event.deltaX : 0;
    if (deltaY) {
      canvas.scrollTop += deltaY;
    }
    if (deltaX) canvas.scrollLeft += deltaX;
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener("wheel", handleWheel, { passive: false, capture: true });
  document.addEventListener("wheel", handleWheel, { passive: false, capture: true });
  window.addEventListener("mousewheel", handleWheel, { passive: false, capture: true });
  document.addEventListener("mousewheel", handleWheel, { passive: false, capture: true });
}

function bindPaletteSearch() {
  const input = document.querySelector('[data-role="palette-search"]');
  if (!input) {
    return;
  }
  input.addEventListener("input", () => {
    state.paletteQuery = input.value || "";
    render();
  });
}

function bindPaletteDrag() {
  document.querySelectorAll(".palette-item").forEach((element) => {
    element.addEventListener("dragstart", (event) => {
      setDragActive(true);
      updateDragPointer(event);
      event.dataTransfer.setData("application/martin-widget", element.dataset.widget);
    });
    element.addEventListener("dragend", () => {
      setDragActive(false);
      document.querySelectorAll(".dropzone.is-over").forEach((zone) => zone.classList.remove("is-over"));
    });
  });
}

function bindDropzones() {
  document.querySelectorAll(".dropzone").forEach((zone) => {
    zone.addEventListener("dragover", (event) => {
      if (!canHandleDrop(event, zone)) {
        return;
      }
      event.preventDefault();
      updateDragPointer(event);
      zone.classList.add("is-over");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("is-over"));
    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      zone.classList.remove("is-over");
      const widgetName = event.dataTransfer.getData("application/martin-widget");
      const nodeId = event.dataTransfer.getData("application/martin-node");
      const dropIndex = Number(zone.dataset.dropIndex ?? -1);
      if (widgetName) {
        setDragActive(false);
        addNode(zone.dataset.dropParent, widgetName, dropIndex);
        return;
      }
      if (nodeId) {
        setDragActive(false);
        moveNode(nodeId, zone.dataset.dropParent, dropIndex);
      }
    });
  });
}

function bindNodeActions() {
  document.querySelectorAll(".node-card").forEach((card) => {
    if (card.getAttribute("draggable") === "true") {
      card.addEventListener("dragstart", (event) => {
        setDragActive(true);
        updateDragPointer(event);
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/martin-node", card.dataset.nodeId);
        card.classList.add("is-dragging");
      });
      card.addEventListener("dragend", () => {
        setDragActive(false);
        card.classList.remove("is-dragging");
        document.querySelectorAll(".dropzone.is-over").forEach((zone) => zone.classList.remove("is-over"));
      });
    }
    card.addEventListener("click", (event) => {
      event.stopPropagation();
      if (event.target.closest("button")) {
        return;
      }
      state.selectedId = event.currentTarget.dataset.nodeId;
      render();
    });
  });

  const canvas = document.querySelector(".canvas-wrap");
  if (canvas) {
    canvas.addEventListener("dragover", updateDragPointer);
  }

  document.querySelectorAll('[data-action="delete-node"]').forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteNode(button.dataset.nodeId);
    });
  });
  document.querySelectorAll('[data-action="toggle-node-collapse"]').forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleNodeCollapse(button.dataset.nodeId);
    });
  });
  document.querySelectorAll('[data-action="duplicate-node"]').forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      duplicateNode(button.dataset.nodeId);
    });
  });
}

function normalizeConditionValue(rawValue) {
  const text = String(rawValue ?? "").trim();
  if (text === "") return "";
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === "true";
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

function readConditionDraft(root) {
  if (!root) {
    return null;
  }
  const enabled = !!root.querySelector('[data-editor-kind="condition-enabled"]')?.checked;
  if (!enabled) {
    return null;
  }
  const mode = root.querySelector('[data-editor-kind="condition-mode"]')?.value || "static";
  if (mode === "static") {
    return {
      __martin_expr__: "ConditionDraft",
      mode: "static",
      staticValue: root.querySelector('[data-editor-kind="condition-static-select"]')?.value !== "false",
      fieldId: "",
      source: "auto",
      operator: "==",
      compareValue: "",
    };
  }
  return {
    __martin_expr__: "ConditionDraft",
    mode: "field",
    staticValue: true,
    fieldId: root.querySelector('[data-editor-kind="condition-field-id"]')?.value?.trim() || "",
    source: root.querySelector('[data-editor-kind="condition-source"]')?.value || "auto",
    operator: root.querySelector('[data-editor-kind="condition-operator"]')?.value || "truthy",
    compareValue: normalizeConditionValue(root.querySelector('[data-editor-kind="condition-value"]')?.value ?? ""),
  };
}

function buildConditionPayload(root) {
  const draft = readConditionDraft(root);
  if (!draft) {
    return null;
  }
  if (draft.mode === "static") {
    return draft.staticValue !== false;
  }
  if (!draft.fieldId) {
    return draft;
  }
  const fieldExpr = { __martin_expr__: "Field", input_id: draft.fieldId, source: draft.source || "auto" };
  if (draft.operator === "truthy") {
    return fieldExpr;
  }
  if (draft.operator === "falsy") {
    return { __martin_expr__: "ConditionNot", expr: fieldExpr };
  }
  return {
    __martin_expr__: "Condition",
    operator: draft.operator || "==",
    left: fieldExpr,
    right: draft.compareValue,
  };
}

function updateConditionField(nodeId, propName) {
  const root = document.querySelector(`[data-editor-kind="condition-root"][data-node-id="${cssEscape(nodeId)}"][data-prop="${cssEscape(propName)}"]`);
  const draftKey = getFieldDraftKey(nodeId, propName);
  const draftValue = readConditionDraft(root);
  if (draftValue) {
    setInspectorDraft(draftKey, draftValue);
  } else {
    clearInspectorDraft(draftKey);
  }
  const payload = buildConditionPayload(root);
  if (payload && payload.__martin_expr__ === "ConditionDraft") {
    render();
    return;
  }
  updateProp(nodeId, propName, payload);
}

function bindInspector() {
  document.querySelectorAll("[data-prop]").forEach((field) => {
    if (field.dataset.editorAction || field.dataset.editorKind) {
      return;
    }
    const tagName = field.tagName.toLowerCase();
    const eventName = field.type === "checkbox" || tagName === "select" || field.type === "date" || field.type === "time" || field.type === "color" ? "change" : "blur";
    if (tagName === "input" || tagName === "textarea") {
      field.addEventListener("input", () => {
        setInspectorDraft(getFieldDraftKey(field.dataset.nodeId, field.dataset.prop), readFieldValue(field));
        if (field.classList.contains("code-editor-input")) {
          updateCodeHighlightMirror(field);
          syncCodeEditorScroll(field);
        }
      });
    }
    if (field.type === "checkbox" || tagName === "select" || field.type === "date" || field.type === "time" || field.type === "color") {
      field.addEventListener("change", () => {
        setInspectorDraft(getFieldDraftKey(field.dataset.nodeId, field.dataset.prop), readFieldValue(field));
      });
    }
    if (field.classList.contains("code-editor-input")) {
      field.addEventListener("keydown", (event) => handleCodeEditorKeydown(event, field));
      field.addEventListener("scroll", () => syncCodeEditorScroll(field));
      updateCodeHighlightMirror(field);
      syncCodeEditorScroll(field);
    }
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
  document.querySelectorAll('[data-editor-action="browse-asset"]').forEach((button) => {
    button.addEventListener("click", () => vscode.postMessage({
      type: "browseAsset",
      payload: {
        nodeId: button.dataset.nodeId,
        prop: button.dataset.prop,
        mediaKind: button.dataset.mediaKind,
      },
    }));
  });
  document.querySelectorAll('[data-editor-action="step-number-field"]').forEach((button) => {
    button.addEventListener("click", () => stepNumberField(
      button.dataset.nodeId,
      button.dataset.prop,
      button.dataset.fieldType,
      button.dataset.stepDirection,
    ));
  });
  document.querySelectorAll('[data-editor-action="pick-icon-value"]').forEach((button) => {
    button.addEventListener("click", () => updateProp(
      button.dataset.nodeId,
      button.dataset.prop,
      button.dataset.iconValue,
    ));
  });
  document.querySelectorAll('[data-editor-action="pick-icon-widget-name"]').forEach((button) => {
    button.addEventListener("click", () => {
      const root = document.querySelector(`[data-editor-kind="icon-widget-root"][data-node-id="${cssEscape(button.dataset.nodeId)}"][data-prop="${cssEscape(button.dataset.prop)}"]`);
      const nameField = root?.querySelector('[data-editor-kind="icon-widget-name"]');
      if (nameField) {
        nameField.value = button.dataset.iconName || "";
      }
      updateIconWidgetField(
        button.dataset.nodeId,
        button.dataset.prop,
      );
    });
  });
  document.querySelectorAll('[data-editor-action="pick-icon-name"]').forEach((button) => {
    button.addEventListener("click", () => updateProp(
      button.dataset.nodeId,
      button.dataset.prop,
      button.dataset.iconName,
    ));
  });
  document.querySelectorAll('[data-editor-kind="icon-widget-mode"]').forEach((field) => {
    field.addEventListener("change", () => changeIconWidgetMode(
      field.dataset.nodeId,
      field.dataset.prop,
      field.value,
    ));
  });
  document.querySelectorAll('[data-editor-kind="icon-widget-provider-custom"]').forEach((field) => {
    field.addEventListener("input", () => syncIconWidgetDraft(field.dataset.nodeId, field.dataset.prop));
    field.addEventListener("blur", () => updateIconWidgetField(field.dataset.nodeId, field.dataset.prop));
  });
  document.querySelectorAll('[data-editor-kind="icon-widget-name"]').forEach((field) => {
    field.addEventListener("input", () => syncIconWidgetDraft(field.dataset.nodeId, field.dataset.prop));
    field.addEventListener("blur", () => updateIconWidgetField(field.dataset.nodeId, field.dataset.prop));
  });
  document.querySelectorAll('[data-editor-kind="icon-provider-select"]').forEach((field) => {
    field.addEventListener("change", () => updateIconProviderField(
      field.dataset.nodeId,
      field.dataset.prop,
      "select",
      field.value,
    ));
  });
  document.querySelectorAll('[data-editor-kind="icon-provider-custom"]').forEach((field) => {
    field.addEventListener("input", () => {
      setInspectorDraft(getFieldDraftKey(field.dataset.nodeId, field.dataset.prop), field.value.trim() || "custom");
    });
    field.addEventListener("blur", () => updateIconProviderField(
      field.dataset.nodeId,
      field.dataset.prop,
      "custom",
      field.value,
    ));
  });
  document.querySelectorAll('[data-editor-kind="code-language-select"]').forEach((field) => {
    field.addEventListener("change", () => updateCodeLanguageField(
      field.dataset.nodeId,
      field.dataset.prop,
      "select",
      field.value,
    ));
  });
  document.querySelectorAll('[data-editor-kind="code-language-custom"]').forEach((field) => {
    field.addEventListener("input", () => {
      setInspectorDraft(getFieldDraftKey(field.dataset.nodeId, field.dataset.prop), field.value.trim() || "custom");
    });
    field.addEventListener("blur", () => updateCodeLanguageField(
      field.dataset.nodeId,
      field.dataset.prop,
      "custom",
      field.value,
    ));
  });
  document.querySelectorAll('[data-editor-kind="condition-enabled"]').forEach((field) => {
    field.addEventListener("change", () => updateConditionField(field.dataset.nodeId, field.dataset.prop));
  });
  document.querySelectorAll('[data-editor-kind="condition-mode"]').forEach((field) => {
    field.addEventListener("change", () => updateConditionField(field.dataset.nodeId, field.dataset.prop));
  });
  document.querySelectorAll('[data-editor-kind="condition-static-select"], [data-editor-kind="condition-source"], [data-editor-kind="condition-operator"]').forEach((field) => {
    field.addEventListener("change", () => updateConditionField(field.dataset.nodeId, field.dataset.prop));
  });
  document.querySelectorAll('[data-editor-kind="condition-field-id"], [data-editor-kind="condition-value"]').forEach((field) => {
    field.addEventListener("blur", () => updateConditionField(field.dataset.nodeId, field.dataset.prop));
  });
  document.querySelectorAll('[data-editor-kind="collection-field"]').forEach((field) => {
    const tagName = field.tagName.toLowerCase();
    const eventName = field.type === "checkbox" || field.type === "date" || field.type === "time" || field.type === "color" || tagName === "select"
      ? "change"
      : "blur";
    const syncDraft = () => {
      syncCollectionDatePair(field);
      setInspectorDraft(
        getCollectionDraftKey(field.dataset.nodeId, field.dataset.prop, Number(field.dataset.index), field.dataset.itemField, field.dataset.dateSource || "main"),
        readCollectionFieldValue(field),
      );
      if (field.dataset.itemType === "date") {
        const partner = findCollectionDatePartner(field);
        if (partner) {
          setInspectorDraft(
            getCollectionDraftKey(partner.dataset.nodeId, partner.dataset.prop, Number(partner.dataset.index), partner.dataset.itemField, partner.dataset.dateSource || "main"),
            readCollectionFieldValue(partner),
          );
        }
      }
    };
    if (tagName === "input" || tagName === "textarea") {
      field.addEventListener("input", syncDraft);
    }
    if (field.type === "checkbox" || field.type === "date" || field.type === "time" || field.type === "color" || tagName === "select") {
      field.addEventListener("change", syncDraft);
    }
    field.addEventListener(eventName, () => updateCollectionField(
      field.dataset.nodeId,
      field.dataset.prop,
      Number(field.dataset.index),
      field.dataset.itemField,
      field.dataset.itemType,
      readCollectionFieldValue(field),
    ));
  });
  document.querySelectorAll('[data-editor-action="step-collection-number-field"]').forEach((button) => {
    button.addEventListener("click", () => stepCollectionNumberField(
      button.dataset.nodeId,
      button.dataset.prop,
      Number(button.dataset.index),
      button.dataset.itemField,
      button.dataset.itemType,
      button.dataset.stepDirection,
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
  persistCollapsedPanels();
  render();
}

function toggleGroup(group) {
  if (!group) {
    return;
  }
  state.collapsedGroups[group] = !state.collapsedGroups[group];
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

function addNode(parentId, widgetName, insertIndex = -1) {
  const widget = getWidget(widgetName);
  const parent = findNodeById(state.design.root, parentId);
  if (!widget || !parent) {
    return;
  }
  const node = createNode(widget);
  parent.children = parent.children || [];
  insertChild(parent, node, insertIndex);
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

function moveNode(nodeId, targetParentId, targetIndex = -1) {
  if (!nodeId || !targetParentId) {
    return;
  }
  const targetParent = findNodeById(state.design.root, targetParentId);
  if (!targetParent || nodeId === state.design.root.id || nodeId === targetParentId) {
    return;
  }
  const draggedNode = findNodeById(state.design.root, nodeId);
  const sourceParent = findParent(state.design.root, nodeId);
  if (!draggedNode || !sourceParent) {
    return;
  }
  if (containsNode(draggedNode, targetParentId)) {
    return;
  }

  const sourceIndex = (sourceParent.children || []).findIndex((child) => child.id === nodeId);
  if (sourceIndex < 0) {
    return;
  }
  sourceParent.children.splice(sourceIndex, 1);

  let normalizedIndex = Number.isInteger(targetIndex) ? targetIndex : targetParent.children.length;
  if (sourceParent.id === targetParent.id && normalizedIndex > sourceIndex) {
    normalizedIndex -= 1;
  }
  insertChild(targetParent, draggedNode, normalizedIndex);
  state.selectedId = draggedNode.id;
  render();
}

function insertChild(parent, child, insertIndex = -1) {
  parent.children = parent.children || [];
  if (!Number.isInteger(insertIndex) || insertIndex < 0 || insertIndex > parent.children.length) {
    parent.children.push(child);
    return;
  }
  parent.children.splice(insertIndex, 0, child);
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
  clearInspectorDraft(getFieldDraftKey(nodeId, propName));
  clearInspectorDraft(getIconWidgetDraftKey(nodeId, propName));
  if (value === "" || value === null || value === undefined) delete node.props[propName];
  else node.props[propName] = value;
  render();
}

function captureScrollPositions() {
  state.scrollPositions.sidebar = document.querySelector(".sidebar")?.scrollTop || 0;
  state.scrollPositions.inspector = document.querySelector(".inspector")?.scrollTop || 0;
  state.scrollPositions.canvas = document.querySelector(".canvas-wrap")?.scrollTop || 0;
  state.scrollPositions.code = document.querySelector(".code-body")?.scrollTop || 0;
}

function restoreScrollPositions() {
  requestAnimationFrame(() => {
    const sidebar = document.querySelector(".sidebar");
    const inspector = document.querySelector(".inspector");
    const canvas = document.querySelector(".canvas-wrap");
    const code = document.querySelector(".code-body");
    if (sidebar) sidebar.scrollTop = state.scrollPositions.sidebar || 0;
    if (inspector) inspector.scrollTop = state.scrollPositions.inspector || 0;
    if (canvas) canvas.scrollTop = state.scrollPositions.canvas || 0;
    if (code) code.scrollTop = state.scrollPositions.code || 0;
  });
}

function captureFocusState() {
  const active = document.activeElement;
  if (active && active.matches && active.matches('[data-role="palette-search"]')) {
    state.focusState.paletteSearchActive = true;
    state.focusState.paletteSearchStart = active.selectionStart || 0;
    state.focusState.paletteSearchEnd = active.selectionEnd || 0;
    delete state.focusState.inspectorField;
    return;
  }
  state.focusState.paletteSearchActive = false;
  if (!active || !active.matches) {
    delete state.focusState.inspectorField;
    return;
  }
  const inspectorField = describeInspectorField(active);
  if (!inspectorField) {
    delete state.focusState.inspectorField;
    return;
  }
  state.focusState.inspectorField = inspectorField;
}

function restoreFocusState() {
  requestAnimationFrame(() => {
    if (state.focusState.paletteSearchActive) {
      const input = document.querySelector('[data-role="palette-search"]');
      if (input) {
        input.focus();
        try {
          input.setSelectionRange(state.focusState.paletteSearchStart, state.focusState.paletteSearchEnd);
        } catch (_error) {
        }
      }
      return;
    }

    const field = restoreInspectorFieldFocus();
    if (!field) {
      return;
    }
  });
}

function describeInspectorField(field) {
  if (!field.closest(".inspector")) {
    return null;
  }
  if (field.dataset.editorAction) {
    return null;
  }
  const descriptor = {
    selector: buildInspectorFieldSelector(field),
    tagName: field.tagName ? field.tagName.toLowerCase() : "",
  };
  if (!descriptor.selector) {
    return null;
  }
  if (descriptor.tagName === "input" || descriptor.tagName === "textarea") {
    descriptor.selectionStart = typeof field.selectionStart === "number" ? field.selectionStart : null;
    descriptor.selectionEnd = typeof field.selectionEnd === "number" ? field.selectionEnd : null;
  }
  return descriptor;
}

function buildInspectorFieldSelector(field) {
  if (field.dataset.role === "palette-search") {
    return '[data-role="palette-search"]';
  }
  if (field.dataset.editorKind === "collection-field") {
    const dateSourceSelector = field.dataset.dateSource
      ? `[data-date-source="${cssEscape(field.dataset.dateSource)}"]`
      : "";
    return `[data-editor-kind="collection-field"][data-node-id="${cssEscape(field.dataset.nodeId || "")}"][data-prop="${cssEscape(field.dataset.prop || "")}"][data-index="${cssEscape(field.dataset.index || "")}"][data-item-field="${cssEscape(field.dataset.itemField || "")}"]${dateSourceSelector}`;
  }
  if (field.dataset.editorKind === "key-value-key" || field.dataset.editorKind === "key-value-value") {
    return `[data-editor-kind="${cssEscape(field.dataset.editorKind)}"][data-node-id="${cssEscape(field.dataset.nodeId || "")}"][data-prop="${cssEscape(field.dataset.prop || "")}"][data-index="${cssEscape(field.dataset.index || "")}"]`;
  }
  if (field.dataset.nodeId && field.dataset.prop) {
    return `[data-node-id="${cssEscape(field.dataset.nodeId)}"][data-prop="${cssEscape(field.dataset.prop)}"]`;
  }
  return "";
}

function restoreInspectorFieldFocus() {
  const descriptor = state.focusState.inspectorField;
  if (!descriptor || !descriptor.selector) {
    return null;
  }
  const field = document.querySelector(descriptor.selector);
  if (!field) {
    return null;
  }
  field.focus();
  if ((descriptor.tagName === "input" || descriptor.tagName === "textarea") && typeof descriptor.selectionStart === "number") {
    try {
      field.setSelectionRange(descriptor.selectionStart, descriptor.selectionEnd ?? descriptor.selectionStart);
    } catch (_error) {
    }
  }
  return field;
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
    if (Object.prototype.hasOwnProperty.call(field, "default")) item[field.name] = clone(field.default);
    else if (field.type === "color") item[field.name] = "#6366f1";
    else if (field.type === "boolean") item[field.name] = false;
    else if (field.type === "integer" || field.type === "float") item[field.name] = "";
    else item[field.name] = "";
  }
  const current = Array.isArray(node.props?.[propName]) ? clone(node.props[propName]) : clone(widget.preset_props?.[propName] || []);
  const newIndex = current.length;
  current.push(item);
  const firstField = Array.isArray(param.editor.fields) && param.editor.fields.length ? param.editor.fields[0] : null;
  if (firstField) {
    const dateSourceSelector = firstField.type === "date"
      ? `[data-date-source="${cssEscape("text")}"]`
      : "";
    state.focusState.inspectorField = {
      selector: `[data-editor-kind="collection-field"][data-node-id="${cssEscape(nodeId)}"][data-prop="${cssEscape(propName)}"][data-index="${cssEscape(String(newIndex))}"][data-item-field="${cssEscape(firstField.name)}"]${dateSourceSelector}`,
      tagName: "input",
      selectionStart: 0,
      selectionEnd: 0,
    };
  }
  updateProp(nodeId, propName, current);
}

function stepNumberField(nodeId, propName, fieldType, direction) {
  const selector = `[data-node-id="${cssEscape(nodeId)}"][data-prop="${cssEscape(propName)}"]`;
  const input = document.querySelector(selector);
  const nextValue = computeSteppedValue(input ? input.value : "", fieldType, direction);
  state.focusState.inspectorField = {
    selector,
    tagName: "input",
    selectionStart: null,
    selectionEnd: null,
  };
  setInspectorDraft(getFieldDraftKey(nodeId, propName), nextValue);
  updateProp(nodeId, propName, parseEditorValue(fieldType, nextValue));
}

function updateCodeLanguageField(nodeId, propName, source, rawValue) {
  const nextValue = source === "select"
    ? (rawValue === "custom" ? "custom" : rawValue)
    : (String(rawValue || "").trim() || "custom");
  setInspectorDraft(getFieldDraftKey(nodeId, propName), nextValue);
  updateProp(nodeId, propName, nextValue);
}

function updateIconProviderField(nodeId, propName, source, rawValue) {
  const nextValue = source === "select"
    ? (rawValue === "none" ? null : (rawValue === "custom" ? "custom" : rawValue))
    : (String(rawValue || "").trim() || "custom");
  setInspectorDraft(getFieldDraftKey(nodeId, propName), nextValue ?? "");
  updateProp(nodeId, propName, nextValue);
}

function syncIconWidgetDraft(nodeId, propName) {
  const nextValue = readIconWidgetEditorValue(nodeId, propName);
  setInspectorDraft(getFieldDraftKey(nodeId, propName), nextValue);
  setInspectorDraft(getIconWidgetDraftKey(nodeId, propName), nextValue);
}

function updateIconWidgetField(nodeId, propName) {
  const nextValue = readIconWidgetEditorValue(nodeId, propName);
  setInspectorDraft(getFieldDraftKey(nodeId, propName), nextValue);
  setInspectorDraft(getIconWidgetDraftKey(nodeId, propName), nextValue);
  updateProp(nodeId, propName, nextValue);
}

function changeIconWidgetMode(nodeId, propName, mode) {
  const existing = parseIconWidgetState(readInspectorDraft(getIconWidgetDraftKey(nodeId, propName), findNodeById(state.design.root, nodeId)?.props?.[propName]));
  let nextValue = "";
  if (mode === "plain") {
    nextValue = existing.plainValue || "";
  } else if (mode === "custom-provider") {
    nextValue = {
      __martin_expr__: "IconWidget",
      provider: existing.customProvider || "",
      name: existing.nameValue || "",
    };
  } else {
    nextValue = {
      __martin_expr__: "IconWidget",
      provider: mode,
      name: existing.nameValue || "",
    };
  }
  setInspectorDraft(getFieldDraftKey(nodeId, propName), nextValue);
  setInspectorDraft(getIconWidgetDraftKey(nodeId, propName), nextValue);
  render();
}

function readIconWidgetEditorValue(nodeId, propName) {
  const root = document.querySelector(`[data-editor-kind="icon-widget-root"][data-node-id="${cssEscape(nodeId)}"][data-prop="${cssEscape(propName)}"]`);
  if (!root) {
    return "";
  }
  const mode = root.querySelector('[data-editor-kind="icon-widget-mode"]')?.value || "plain";
  if (mode === "plain") {
    return root.querySelector('input[data-field-type="string"]')?.value || "";
  }
  const provider = mode === "custom-provider"
    ? (root.querySelector('[data-editor-kind="icon-widget-provider-custom"]')?.value || "").trim()
    : mode;
  const name = (root.querySelector('[data-editor-kind="icon-widget-name"]')?.value || "").trim();
  if (!provider || !name) {
    return "";
  }
  return {
    __martin_expr__: "IconWidget",
    name,
    provider,
  };
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

function stepCollectionNumberField(nodeId, propName, index, fieldName, fieldType, direction) {
  const selector = `[data-editor-kind="collection-field"][data-node-id="${cssEscape(nodeId)}"][data-prop="${cssEscape(propName)}"][data-index="${cssEscape(String(index))}"][data-item-field="${cssEscape(fieldName)}"]`;
  const input = document.querySelector(selector);
  const nextValue = computeSteppedValue(input ? input.value : "", fieldType, direction);
  state.focusState.inspectorField = {
    selector,
    tagName: "input",
    selectionStart: null,
    selectionEnd: null,
  };
  setInspectorDraft(getCollectionDraftKey(nodeId, propName, index, fieldName, "main"), nextValue);
  updateCollectionField(nodeId, propName, index, fieldName, fieldType, nextValue);
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
  clearInspectorDraft(getCollectionDraftKey(nodeId, propName, index, fieldName, "main"));
  clearInspectorDraft(getCollectionDraftKey(nodeId, propName, index, fieldName, "text"));
  clearInspectorDraft(getCollectionDraftKey(nodeId, propName, index, fieldName, "picker"));
  if (value === undefined) {
    delete current[index][fieldName];
  } else {
    current[index][fieldName] = value;
  }
  node.props = node.props || {};
  node.props[propName] = current;
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

function readCollectionFieldValue(field) {
  if (field.type === "checkbox") {
    return field.checked;
  }
  if (field.dataset.itemType === "date") {
    return field.value.trim();
  }
  return field.value;
}

function parseEditorValue(type, rawValue) {
  if (type === "boolean") {
    return Boolean(rawValue);
  }
  if (type === "integer") {
    return rawValue === "" ? null : Number.parseInt(rawValue, 10);
  }
  if (type === "float") {
    return rawValue === "" ? null : Number.parseFloat(rawValue);
  }
  if (type === "date" || type === "time" || type === "color") {
    return rawValue === null || rawValue === undefined ? "" : String(rawValue).trim();
  }
  return rawValue;
}

function computeSteppedValue(rawValue, fieldType, direction) {
  const step = fieldType === "float" ? 0.1 : 1;
  const numeric = rawValue === "" || rawValue === null || rawValue === undefined
    ? 0
    : Number.parseFloat(rawValue);
  const safeNumeric = Number.isFinite(numeric) ? numeric : 0;
  const delta = direction === "down" ? -step : step;
  const next = safeNumeric + delta;
  return fieldType === "float"
    ? String(Number(next.toFixed(2)))
    : String(Math.trunc(next));
}

function handleCodeEditorKeydown(event, field) {
  if (!field || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }
  const pairs = {
    "(": ")",
    "[": "]",
    "{": "}",
    "\"": "\"",
    "'": "'",
    "`": "`",
    "<": ">",
  };
  const closers = new Set(Object.values(pairs));
  const key = event.key;

  if (Object.prototype.hasOwnProperty.call(pairs, key)) {
    const open = key;
    const close = pairs[key];
    const start = field.selectionStart ?? 0;
    const end = field.selectionEnd ?? start;
    const value = field.value || "";
    const selected = value.slice(start, end);
    const nextChar = value.slice(start, start + 1);
    const prevChar = value.slice(Math.max(0, start - 1), start);

    if ((open === "\"" || open === "'" || open === "`") && selected.length === 0) {
      if (nextChar === close) {
        event.preventDefault();
        field.setSelectionRange(start + 1, start + 1);
        return;
      }
      if (prevChar && /[A-Za-z0-9_]/.test(prevChar)) {
        return;
      }
    }

    if (open === "<" && shouldBypassAngleBracketAutocomplete(field, start, end)) {
      return;
    }

    event.preventDefault();
    const insertion = `${open}${selected}${close}`;
    field.setRangeText(insertion, start, end, "end");
    if (!selected.length) {
      field.setSelectionRange(start + 1, start + 1);
    } else {
      field.setSelectionRange(start + 1, start + 1 + selected.length);
    }
    triggerCodeEditorInput(field);
    return;
  }

  if (closers.has(key) && (field.selectionStart ?? 0) === (field.selectionEnd ?? 0)) {
    const start = field.selectionStart ?? 0;
    const value = field.value || "";
    if (value.slice(start, start + 1) === key) {
      event.preventDefault();
      field.setSelectionRange(start + 1, start + 1);
      return;
    }
  }
}

function shouldBypassAngleBracketAutocomplete(field, start, end) {
  const value = field.value || "";
  const selected = value.slice(start, end);
  if (selected.length) {
    return false;
  }
  const nextChar = value.slice(start, start + 1);
  const prevChar = value.slice(Math.max(0, start - 1), start);
  if (nextChar === ">") {
    return false;
  }
  if (prevChar === "<" || prevChar === "/" || prevChar === "!" || prevChar === "?") {
    return false;
  }
  if (!prevChar) {
    return true;
  }
  return /[\s=({[,;:+\-*]/.test(prevChar);
}

function triggerCodeEditorInput(field) {
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function updateCodeHighlightMirror(field) {
  if (!field) {
    return;
  }
  const highlightId = field.dataset.codeHighlight;
  if (!highlightId) {
    return;
  }
  const mirror = document.querySelector(`[data-code-highlight="${cssEscape(highlightId)}"]:not(textarea)`);
  if (!mirror) {
    return;
  }
  mirror.innerHTML = `${highlightCodeHtml(field.value, field.dataset.codeLanguage || "python")}\n`;
}

function syncCodeEditorScroll(field) {
  if (!field) {
    return;
  }
  const highlightId = field.dataset.codeHighlight;
  if (!highlightId) {
    return;
  }
  const mirror = document.querySelector(`[data-code-highlight="${cssEscape(highlightId)}"]:not(textarea)`);
  if (!mirror) {
    return;
  }
  mirror.scrollTop = field.scrollTop;
  mirror.scrollLeft = field.scrollLeft;
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

function findCollectionDatePartner(field) {
  if (!field || field.dataset.itemType !== "date") {
    return null;
  }
  const selector = `[data-editor-kind="collection-field"][data-node-id="${cssEscape(field.dataset.nodeId || "")}"][data-prop="${cssEscape(field.dataset.prop || "")}"][data-index="${cssEscape(field.dataset.index || "")}"][data-item-field="${cssEscape(field.dataset.itemField || "")}"][data-date-source="${cssEscape(field.dataset.dateSource === "picker" ? "text" : "picker")}"]`;
  return document.querySelector(selector);
}

function syncCollectionDatePair(field) {
  const partner = findCollectionDatePartner(field);
  if (!partner) {
    return;
  }
  const nextValue = field.value || "";
  if (partner.value !== nextValue) {
    partner.value = nextValue;
  }
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

function containsNode(node, candidateId) {
  if (!node) {
    return false;
  }
  if (node.id === candidateId) {
    return true;
  }
  return (node.children || []).some((child) => containsNode(child, candidateId));
}

function canHandleDrop(event, zone) {
  const widgetName = event.dataTransfer.getData("application/martin-widget");
  if (widgetName) {
    return true;
  }
  const nodeId = event.dataTransfer.getData("application/martin-node");
  if (!nodeId) {
    return false;
  }
  const targetParentId = zone.dataset.dropParent;
  if (!targetParentId || nodeId === targetParentId) {
    return false;
  }
  const draggedNode = findNodeById(state.design.root, nodeId);
  return draggedNode ? !containsNode(draggedNode, targetParentId) : false;
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

function getWidgetIcon(name) {
  return WIDGET_ICONS[name] || "◇";
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

function countDescendants(node) {
  let total = 0;
  for (const child of node.children || []) {
    total += 1 + countDescendants(child);
  }
  return total;
}

function shouldAutoCollapseNode(node, depth = 0) {
  if (!node || depth === 0) {
    return false;
  }
  const childCount = (node.children || []).length;
  const totalDescendants = countDescendants(node);
  return childCount >= 8 || totalDescendants >= 20 || depth >= 4;
}

function seedCollapsedNodes(node, depth = 0) {
  if (!node) {
    return;
  }
  if (shouldAutoCollapseNode(node, depth) && state.collapsedNodes[node.id] === undefined) {
    state.collapsedNodes[node.id] = true;
  }
  for (const child of node.children || []) {
    seedCollapsedNodes(child, depth + 1);
  }
}

function expandSelectedPath() {
  let currentId = state.selectedId;
  while (currentId) {
    delete state.collapsedNodes[currentId];
    const parent = findParent(state.design.root, currentId);
    currentId = parent ? parent.id : "";
  }
}

function initializeCollapsedNodes() {
  state.collapsedNodes = state.collapsedNodes || {};
  seedCollapsedNodes(state.design.root, 0);
  expandSelectedPath();
}

function toggleNodeCollapse(nodeId) {
  if (!nodeId) {
    return;
  }
  state.collapsedNodes[nodeId] = !state.collapsedNodes[nodeId];
  render();
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
  collectPropImports(node.props || {}, imports);
  for (const child of node.children || []) collectImports(child, imports);
}

function collectPropImports(value, imports) {
  if (!value) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectPropImports(item, imports));
    return;
  }
  if (typeof value !== "object") {
    return;
  }
  if (value.__martin_expr__ === "IconWidget") {
    imports.add("Icon");
    return;
  }
  if (value.__martin_expr__ === "Field" || value.__martin_expr__ === "Condition" || value.__martin_expr__ === "ConditionGroup" || value.__martin_expr__ === "ConditionNot") {
    imports.add("Field");
    return;
  }
  if (value.__martin_expr__ === "Ref") {
    return;
  }
  Object.values(value).forEach((item) => collectPropImports(item, imports));
}

function getRequiredImports(design) {
  const imports = new Set();
  collectImports(design.root, imports);
  if (imports.has("Calendar")) {
    imports.add("CalendarEvent");
  }
  return Array.from(imports);
}

function nodeToPython(node, depth) {
  const indent = "    ".repeat(depth);
  const lines = [];
  const props = [];
  const positionalProp = POSITIONAL_PROP_MAP[node.type];
  const nodeProps = { ...(node.props || {}) };
  if (positionalProp && nodeProps[positionalProp] !== undefined) {
    props.push(pyPropValue(node.type, positionalProp, nodeProps[positionalProp], depth + 1));
    delete nodeProps[positionalProp];
  }
  for (const [key, value] of Object.entries(nodeProps)) props.push(`${key}=${pyPropValue(node.type, key, value, depth + 1)}`);
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
    props.push(pyPropValue(node.type, positionalProp, nodeProps[positionalProp], depth + 1));
    delete nodeProps[positionalProp];
  }
  for (const [key, value] of Object.entries(nodeProps)) props.push(`${key}=${pyPropValue(node.type, key, value, depth + 1)}`);
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
    const martinExpr = pyMartinExpr(value, depth);
    if (martinExpr) {
      return martinExpr;
    }
    const entries = Object.entries(value);
    if (!entries.length) return "{}";
    return `{\n${entries.map(([key, entryValue]) => `${indent}${pyString(key)}: ${pyValue(entryValue, depth + 1)}`).join(",\n")}\n${"    ".repeat(depth - 1)}}`;
  }
  return pyString(String(value));
}

function pyPropValue(widgetType, propName, value, depth) {
  if (widgetType === "Calendar" && propName === "events" && Array.isArray(value)) {
    return pyCalendarEvents(value, depth);
  }
  return pyValue(value, depth);
}

function pyCalendarEvents(events, depth) {
  const indent = "    ".repeat(depth);
  const closingIndent = "    ".repeat(Math.max(depth - 1, 0));
  if (!events.length) {
    return "[]";
  }
  return `[\n${events.map((event) => `${indent}${pyCalendarEvent(event, depth + 1)}`).join(",\n")}\n${closingIndent}]`;
}

function pyCalendarEvent(event, depth) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return pyValue(event, depth);
  }
  const fields = [];
  const orderedKeys = ["title", "date", "start_time", "end_time", "color", "description", "all_day", "url"];
  for (const key of orderedKeys) {
    if (event[key] !== undefined && event[key] !== null && event[key] !== "") {
      fields.push(`${key}=${pyValue(event[key], depth + 1)}`);
    }
  }
  if (!fields.length) {
    return "CalendarEvent()";
  }
  return `CalendarEvent(${fields.join(", ")})`;
}

function pyMartinExpr(value, depth) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }
  const exprType = value.__martin_expr__;
  if (exprType === "Ref") {
    const args = [pyValue(value.input_id, depth + 1)];
    if (value.label) {
      args.push("label=True");
    }
    return `Ref(${args.join(", ")})`;
  }
  if (exprType === "Field") {
    const args = [pyValue(value.input_id, depth + 1)];
    if (value.source && value.source !== "auto") {
      args.push(`source=${pyValue(value.source, depth + 1)}`);
    }
    return `Field(${args.join(", ")})`;
  }
  if (exprType === "Condition") {
    const left = pyValue(value.left, depth + 1);
    const right = pyValue(value.right, depth + 1);
    const operator = String(value.operator || "==");
    if (operator === "contains") return `${left}.contains(${right})`;
    if (operator === "starts_with") return `${left}.startswith(${right})`;
    if (operator === "ends_with") return `${left}.endswith(${right})`;
    return `(${left} ${operator} ${right})`;
  }
  if (exprType === "ConditionGroup") {
    const items = Array.isArray(value.items) ? value.items : [];
    const separator = (value.operator || "and") === "or" ? " | " : " & ";
    return `(${items.map((item) => pyValue(item, depth + 1)).join(separator)})`;
  }
  if (exprType === "ConditionNot") {
    return `~(${pyValue(value.expr, depth + 1)})`;
  }
  if (exprType === "IconWidget") {
    const parts = [];
    if (value.icon !== undefined && value.icon !== null && value.icon !== "") parts.push(`icon=${pyValue(value.icon, depth + 1)}`);
    if (value.name) parts.push(`name=${pyValue(value.name, depth + 1)}`);
    if (value.provider) parts.push(`provider=${pyValue(value.provider, depth + 1)}`);
    if (value.variant) parts.push(`variant=${pyValue(value.variant, depth + 1)}`);
    if (value.icon_class) parts.push(`icon_class=${pyValue(value.icon_class, depth + 1)}`);
    if (value.class_name) parts.push(`class_name=${pyValue(value.class_name, depth + 1)}`);
    if (value.base_class) parts.push(`base_class=${pyValue(value.base_class, depth + 1)}`);
    if (value.name_prefix) parts.push(`name_prefix=${pyValue(value.name_prefix, depth + 1)}`);
    if (value.name_suffix) parts.push(`name_suffix=${pyValue(value.name_suffix, depth + 1)}`);
    if (value.size !== undefined && value.size !== null && value.size !== "") parts.push(`size=${pyValue(value.size, depth + 1)}`);
    return `Icon(${parts.join(", ")})`;
  }
  if (exprType === "ApiCall") {
    const parts = [];
    if (value.url !== undefined) parts.push(pyValue(value.url, depth + 1));
    if (value.method !== undefined && value.method !== "POST") parts.push(`method=${pyValue(value.method, depth + 1)}`);
    if (value.body !== undefined && value.body !== null) parts.push(`body=${pyValue(value.body, depth + 1)}`);
    if (value.target) parts.push(`target=${pyValue(value.target, depth + 1)}`);
    if (value.loading) parts.push(`loading=${pyValue(value.loading, depth + 1)}`);
    if (value.on_success) parts.push(`on_success=${pyValue(value.on_success, depth + 1)}`);
    if (value.on_error) parts.push(`on_error=${pyValue(value.on_error, depth + 1)}`);
    return `ApiCall(${parts.join(", ")})`;
  }
  if (exprType === "MethodCall") {
    const parts = [];
    if (value.method !== undefined) parts.push(pyValue(value.method, depth + 1));
    if (value.params !== undefined && value.params !== null) parts.push(`params=${pyValue(value.params, depth + 1)}`);
    if (value.args !== undefined && value.args !== null) parts.push(`args=${pyValue(value.args, depth + 1)}`);
    if (value.kwargs !== undefined && value.kwargs !== null) parts.push(`kwargs=${pyValue(value.kwargs, depth + 1)}`);
    if (value.endpoint && value.endpoint !== "/api/_method") parts.push(`endpoint=${pyValue(value.endpoint, depth + 1)}`);
    if (value.target) parts.push(`target=${pyValue(value.target, depth + 1)}`);
    if (value.loading) parts.push(`loading=${pyValue(value.loading, depth + 1)}`);
    if (value.on_success) parts.push(`on_success=${pyValue(value.on_success, depth + 1)}`);
    if (value.on_error) parts.push(`on_error=${pyValue(value.on_error, depth + 1)}`);
    return `MethodCall(${parts.join(", ")})`;
  }
  return "";
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
