(() => {
  "use strict";

  const STORAGE_KEY = "electron-ai-state-v1";
  const SETTINGS_KEY = "electron-ai-settings-v1";
  const MAX_ATTACHMENT_BYTES = 120_000;

  const MODELS = [
    {
      id: "gpt-5.5",
      name: "ChatGPT 5.5",
      short: "O",
      role: "Lead reasoning & synthesis",
      color: "#54d8ad",
    },
    {
      id: "claude-opus-4-8",
      name: "Claude Opus 4.8",
      short: "A",
      role: "Primary code review",
      color: "#e3a260",
    },
    {
      id: "claude-opus-4-7",
      name: "Claude Opus 4.7",
      short: "A",
      role: "Architecture alternatives",
      color: "#d38d66",
    },
    {
      id: "claude-opus-4-6",
      name: "Claude Opus 4.6",
      short: "A",
      role: "Long-horizon planning",
      color: "#bd7b64",
    },
    {
      id: "gemini-3.1-pro-preview",
      name: "Gemini 3.1 Pro",
      short: "G",
      role: "Multimodal & research",
      color: "#6c9cff",
    },
    {
      id: "qwen3.7-max",
      name: "Qwen 3.7 Max",
      short: "Q",
      role: "Diverse reasoning pass",
      color: "#9d82ff",
    },
    {
      id: "claude-sonnet-4-6",
      name: "Claude Sonnet 4.6",
      short: "A",
      role: "Fast implementation",
      color: "#efbd78",
    },
  ];

  const els = {};
  let state = loadState();
  let settings = loadSettings();
  let pendingFiles = [];
  let activeRun = null;
  let statusTimer = null;
  let toastTimer = null;

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    ensureInitialChat();
    renderModels();
    restoreControls();
    bindEvents();
    render();
    updateTextareaHeight();
  }

  function cacheElements() {
    [
      "sidebar",
      "sidebarBackdrop",
      "openSidebar",
      "closeSidebar",
      "newChatButton",
      "chatList",
      "chatCount",
      "currentChatTitle",
      "renameChatButton",
      "clearChatButton",
      "messages",
      "welcome",
      "composer",
      "promptInput",
      "sendButton",
      "attachButton",
      "fileInput",
      "attachmentCount",
      "editorTarget",
      "effortLevel",
      "runBanner",
      "runStatus",
      "stopRunButton",
      "toggleCouncil",
      "closeCouncil",
      "councilPanel",
      "modelList",
      "toggleAllModels",
      "approvalOptions",
      "policyBadge",
      "editorDrawer",
      "closeEditor",
      "codeEditor",
      "lineNumbers",
      "editorFilename",
      "editorState",
      "copyCodeButton",
      "downloadCodeButton",
      "openVsCodeButton",
      "openSettings",
      "openAbout",
      "settingsModal",
      "settingsForm",
      "backendUrl",
      "accessToken",
      "testConnection",
      "connectionTest",
      "connectionLabel",
      "connectionDot",
      "approvalModal",
      "approvalTitle",
      "approvalDescription",
      "approvalChoices",
      "approveRun",
      "toast",
    ].forEach((id) => {
      els[id] = document.getElementById(id);
    });
  }

  function bindEvents() {
    els.newChatButton.addEventListener("click", createChat);
    els.composer.addEventListener("submit", handleSubmit);
    els.promptInput.addEventListener("input", updateTextareaHeight);
    els.promptInput.addEventListener("keydown", handlePromptKeys);
    els.attachButton.addEventListener("click", () => els.fileInput.click());
    els.fileInput.addEventListener("change", handleFiles);
    els.editorTarget.addEventListener("change", persistControlSettings);
    els.effortLevel.addEventListener("change", persistControlSettings);
    els.stopRunButton.addEventListener("click", stopRun);
    els.toggleCouncil.addEventListener("click", () => els.councilPanel.classList.toggle("open"));
    els.closeCouncil.addEventListener("click", () => els.councilPanel.classList.remove("open"));
    els.openSidebar.addEventListener("click", openSidebar);
    els.closeSidebar.addEventListener("click", closeSidebar);
    els.sidebarBackdrop.addEventListener("click", closeSidebar);
    els.renameChatButton.addEventListener("click", renameCurrentChat);
    els.clearChatButton.addEventListener("click", clearCurrentChat);
    els.toggleAllModels.addEventListener("click", toggleAllModels);
    els.approvalOptions.addEventListener("change", handleApprovalPolicy);
    els.closeEditor.addEventListener("click", closeEditor);
    els.codeEditor.addEventListener("input", handleEditorInput);
    els.codeEditor.addEventListener("scroll", syncEditorScroll);
    els.codeEditor.addEventListener("keydown", handleEditorKeys);
    els.copyCodeButton.addEventListener("click", copyEditorCode);
    els.downloadCodeButton.addEventListener("click", downloadEditorCode);
    els.openVsCodeButton.addEventListener("click", openInVsCode);
    els.openSettings.addEventListener("click", openSettings);
    els.settingsForm.addEventListener("submit", saveConnection);
    els.testConnection.addEventListener("click", testConnection);
    els.openAbout.addEventListener("click", () => {
      showToast("Electron AI stores chats locally in this browser.");
    });

    document.querySelectorAll(".starter-card").forEach((button) => {
      button.addEventListener("click", () => {
        els.promptInput.value = button.dataset.prompt;
        updateTextareaHeight();
        els.promptInput.focus();
      });
    });

    document.addEventListener("keydown", (event) => {
      const commandKey = event.ctrlKey || event.metaKey;
      if (commandKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        createChat();
      }
      if (event.key === "Escape") {
        closeEditor();
        closeSidebar();
        els.councilPanel.classList.remove("open");
      }
    });
  }

  function defaultState() {
    return {
      activeChatId: "",
      chats: [],
    };
  }

  function defaultSettings() {
    return {
      backendUrl: "",
      accessToken: "",
      editorTarget: "web",
      effort: "balanced",
      approval: "alternatives",
      models: Object.fromEntries(MODELS.map((model) => [model.id, true])),
    };
  }

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return parsed && Array.isArray(parsed.chats) ? parsed : defaultState();
    } catch {
      return defaultState();
    }
  }

  function loadSettings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY));
      return { ...defaultSettings(), ...(parsed || {}), accessToken: "" };
    } catch {
      return defaultSettings();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function saveSettings() {
    const { accessToken: _sessionOnlyToken, ...persistedSettings } = settings;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(persistedSettings));
  }

  function ensureInitialChat() {
    if (!state.chats.length) {
      const chat = makeChat();
      state.chats.push(chat);
      state.activeChatId = chat.id;
      saveState();
    }
    if (!getActiveChat()) {
      state.activeChatId = state.chats[0].id;
    }
  }

  function makeChat() {
    const now = new Date().toISOString();
    return {
      id: createId(),
      title: "New conversation",
      createdAt: now,
      updatedAt: now,
      messages: [],
      artifact: null,
    };
  }

  function createId() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function getActiveChat() {
    return state.chats.find((chat) => chat.id === state.activeChatId);
  }

  function createChat() {
    stopRun();
    const chat = makeChat();
    state.chats.unshift(chat);
    state.activeChatId = chat.id;
    saveState();
    closeEditor();
    closeSidebar();
    render();
    els.promptInput.focus();
  }

  function selectChat(id) {
    stopRun();
    state.activeChatId = id;
    saveState();
    closeEditor();
    closeSidebar();
    render();
  }

  function deleteChat(id, event) {
    event.stopPropagation();
    state.chats = state.chats.filter((chat) => chat.id !== id);
    if (!state.chats.length) {
      const replacement = makeChat();
      state.chats.push(replacement);
      state.activeChatId = replacement.id;
    } else if (state.activeChatId === id) {
      state.activeChatId = state.chats[0].id;
    }
    saveState();
    render();
  }

  function renameCurrentChat() {
    const chat = getActiveChat();
    if (!chat) return;
    const nextTitle = window.prompt("Rename this conversation", chat.title);
    if (!nextTitle?.trim()) return;
    chat.title = nextTitle.trim().slice(0, 72);
    chat.updatedAt = new Date().toISOString();
    saveState();
    renderChatList();
    renderHeader();
  }

  function clearCurrentChat() {
    const chat = getActiveChat();
    if (!chat || (!chat.messages.length && !chat.artifact)) return;
    if (!window.confirm("Clear all messages and generated code in this conversation?")) return;
    chat.messages = [];
    chat.artifact = null;
    chat.title = "New conversation";
    chat.updatedAt = new Date().toISOString();
    saveState();
    closeEditor();
    render();
  }

  function render() {
    renderChatList();
    renderHeader();
    renderMessages();
    renderConnectionState();
  }

  function renderChatList() {
    els.chatList.textContent = "";
    const orderedChats = [...state.chats].sort(
      (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt),
    );
    orderedChats.forEach((chat) => {
      const button = document.createElement("div");
      button.className = `chat-item${chat.id === state.activeChatId ? " active" : ""}`;
      button.role = "button";
      button.tabIndex = 0;
      button.addEventListener("click", () => selectChat(chat.id));
      button.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectChat(chat.id);
        }
      });

      const icon = document.createElement("span");
      icon.className = "chat-icon";
      icon.textContent = chat.messages.length ? "◇" : "＋";

      const copy = document.createElement("span");
      copy.className = "chat-copy";
      const title = document.createElement("strong");
      title.textContent = chat.title;
      const meta = document.createElement("small");
      meta.textContent = formatRelativeTime(chat.updatedAt);
      copy.append(title, meta);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "chat-delete";
      remove.title = "Delete chat";
      remove.textContent = "×";
      remove.addEventListener("click", (event) => deleteChat(chat.id, event));

      button.append(icon, copy, remove);
      els.chatList.appendChild(button);
    });
    els.chatCount.textContent = String(state.chats.length);
  }

  function renderHeader() {
    const chat = getActiveChat();
    els.currentChatTitle.textContent = chat?.title || "New conversation";
  }

  function renderMessages() {
    const chat = getActiveChat();
    els.messages.textContent = "";
    const messages = chat?.messages || [];
    els.welcome.classList.toggle("hidden", messages.length > 0);
    messages.forEach((message) => {
      els.messages.appendChild(createMessageElement(message));
    });
    requestAnimationFrame(() => {
      els.messages.scrollTop = els.messages.scrollHeight;
    });
  }

  function createMessageElement(message) {
    const fragment = document.getElementById("messageTemplate").content.cloneNode(true);
    const article = fragment.querySelector(".message");
    const avatar = fragment.querySelector(".message-avatar");
    const name = fragment.querySelector(".message-meta strong");
    const time = fragment.querySelector(".message-meta span");
    const body = fragment.querySelector(".message-body");
    const actions = fragment.querySelector(".message-actions");

    article.classList.add(message.role);
    avatar.textContent = message.role === "user" ? "YOU" : "EA";
    name.textContent = message.role === "user" ? "You" : "Electron council";
    time.textContent = message.meta || formatClock(message.createdAt);
    body.innerHTML = safeMarkdown(message.content);

    actions.querySelector('[data-action="copy"]').addEventListener("click", async () => {
      await copyText(message.content);
      showToast("Message copied");
    });
    actions.querySelector('[data-action="editor"]').addEventListener("click", () => {
      const chat = getActiveChat();
      if (chat?.artifact) {
        openEditor(chat.artifact);
      } else {
        showToast("This response does not include a code artifact.");
      }
    });
    return fragment;
  }

  function renderModels() {
    els.modelList.textContent = "";
    MODELS.forEach((model) => {
      const row = document.createElement("div");
      row.className = "model-item";
      row.style.setProperty("--model-color", model.color);

      const logo = document.createElement("span");
      logo.className = "model-logo";
      logo.textContent = model.short;

      const copy = document.createElement("span");
      copy.className = "model-copy";
      const name = document.createElement("strong");
      name.textContent = model.name;
      const role = document.createElement("small");
      role.textContent = model.role;
      copy.append(name, role);

      const label = document.createElement("label");
      label.className = "switch";
      label.title = `Toggle ${model.name}`;
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.modelId = model.id;
      input.checked = settings.models[model.id] !== false;
      input.addEventListener("change", () => {
        settings.models[model.id] = input.checked;
        ensureOneModel(input);
        saveSettings();
        updateModelSummary();
      });
      const track = document.createElement("span");
      label.append(input, track);
      row.append(logo, copy, label);
      els.modelList.appendChild(row);
    });
    updateModelSummary();
  }

  function ensureOneModel(changedInput) {
    const enabled = activeModelIds();
    if (enabled.length) return;
    changedInput.checked = true;
    settings.models[changedInput.dataset.modelId] = true;
    showToast("At least one model must remain active.");
  }

  function toggleAllModels() {
    const inputs = [...els.modelList.querySelectorAll("input")];
    const allEnabled = inputs.every((input) => input.checked);
    inputs.forEach((input, index) => {
      input.checked = allEnabled ? index === 0 : true;
      settings.models[input.dataset.modelId] = input.checked;
    });
    saveSettings();
    updateModelSummary();
  }

  function updateModelSummary() {
    const count = activeModelIds().length;
    const ring = document.querySelector(".summary-ring span");
    const summary = document.querySelector(".council-summary strong");
    if (ring) ring.textContent = String(count);
    if (summary) summary.textContent = count === MODELS.length ? "Full council enabled" : `${count} specialists enabled`;
    els.toggleAllModels.textContent = count === MODELS.length ? "Disable all" : "Enable all";
    document.querySelector(".live-status span:last-child").textContent = `${count} agent${count === 1 ? "" : "s"} ready`;
  }

  function activeModelIds() {
    return MODELS.filter((model) => settings.models[model.id] !== false).map(
      (model) => model.id,
    );
  }

  function restoreControls() {
    els.editorTarget.value = settings.editorTarget;
    els.effortLevel.value = settings.effort;
    const approvalInput = els.approvalOptions.querySelector(
      `input[value="${settings.approval}"]`,
    );
    if (approvalInput) approvalInput.checked = true;
    updatePolicyBadge();
  }

  function persistControlSettings() {
    settings.editorTarget = els.editorTarget.value;
    settings.effort = els.effortLevel.value;
    saveSettings();
  }

  function handleApprovalPolicy(event) {
    if (!event.target.matches('input[name="approval"]')) return;
    settings.approval = event.target.value;
    saveSettings();
    updatePolicyBadge();
  }

  function updatePolicyBadge() {
    const labels = {
      everything: "EVERYTHING",
      alternatives: "ALTERNATIVES",
      features: "FEATURES",
      none: "AUTONOMOUS",
    };
    els.policyBadge.textContent = labels[settings.approval] || "ALTERNATIVES";
  }

  function updateTextareaHeight() {
    els.promptInput.style.height = "auto";
    els.promptInput.style.height = `${Math.min(180, els.promptInput.scrollHeight)}px`;
  }

  function handlePromptKeys(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      els.composer.requestSubmit();
    }
  }

  async function handleFiles(event) {
    const files = [...event.target.files];
    pendingFiles = [];
    for (const file of files) {
      const attachment = {
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
      };
      if (file.size <= MAX_ATTACHMENT_BYTES && isReadableText(file)) {
        attachment.text = await file.text();
      }
      pendingFiles.push(attachment);
    }
    els.attachmentCount.textContent = pendingFiles.length
      ? `${pendingFiles.length} file${pendingFiles.length === 1 ? "" : "s"}`
      : "";
    if (files.some((file) => file.size > MAX_ATTACHMENT_BYTES)) {
      showToast("Large files are attached as metadata only.");
    }
  }

  function isReadableText(file) {
    return (
      file.type.startsWith("text/") ||
      /\.(js|jsx|ts|tsx|html|css|json|md|txt|py|java|go|rs|yaml|yml)$/i.test(file.name)
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (activeRun) return;
    const prompt = els.promptInput.value.trim();
    if (!prompt) return;

    const chat = getActiveChat();
    if (!chat) return;
    const attachments = pendingFiles;
    pendingFiles = [];
    els.fileInput.value = "";
    els.attachmentCount.textContent = "";

    addMessage(chat, {
      role: "user",
      content: promptWithAttachments(prompt, attachments),
    });
    if (chat.messages.filter((message) => message.role === "user").length === 1) {
      chat.title = deriveTitle(prompt);
    }
    els.promptInput.value = "";
    updateTextareaHeight();
    saveState();
    render();

    const approval = await maybeRequestApproval(prompt);
    if (!approval.approved) {
      addMessage(chat, {
        role: "assistant",
        content: "Run canceled before any model request was sent.",
        meta: "Approval declined",
      });
      saveState();
      render();
      return;
    }

    const run = {
      id: createId(),
      controller: new AbortController(),
    };
    activeRun = run;
    setRunning(true, run.id);
    cycleRunStatus();

    try {
      const result = settings.backendUrl
        ? await requestBackend(prompt, attachments, approval.selection, run.controller.signal)
        : await createDemoResult(prompt, approval.selection, run.controller.signal);

      const activeChat = getActiveChat();
      if (!activeChat || activeChat.id !== chat.id || activeRun?.id !== run.id) return;
      addMessage(activeChat, {
        role: "assistant",
        content: result.answer,
        meta: result.meta || `${activeModelIds().length} agents · ${settings.effort} effort`,
      });
      if (result.artifact?.content) {
        activeChat.artifact = result.artifact;
      }
      activeChat.updatedAt = new Date().toISOString();
      saveState();
      render();

      if (result.artifact && settings.editorTarget !== "response") {
        openEditor(result.artifact);
        if (settings.editorTarget === "vscode") {
          showToast("Artifact ready. Use “Open in VS Code” to approve the handoff.");
        }
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        addMessage(chat, {
          role: "assistant",
          content: `The council could not complete this run.\n\n\`${error.message || "Unknown connection error"}\`\n\nYour message is saved. Check the backend URL, access token, provider keys, and Worker logs, then try again.`,
          meta: "Run failed",
        });
        saveState();
        render();
      }
    } finally {
      if (activeRun?.id === run.id) {
        activeRun = null;
        setRunning(false, run.id);
      }
    }
  }

  function promptWithAttachments(prompt, attachments) {
    if (!attachments.length) return prompt;
    const names = attachments.map((file) => `\`${file.name}\``).join(", ");
    return `${prompt}\n\nAttached: ${names}`;
  }

  function deriveTitle(prompt) {
    const clean = prompt.replace(/\s+/g, " ").trim();
    return clean.length > 46 ? `${clean.slice(0, 45)}…` : clean;
  }

  function addMessage(chat, message) {
    chat.messages.push({
      id: createId(),
      createdAt: new Date().toISOString(),
      ...message,
    });
    chat.updatedAt = new Date().toISOString();
  }

  async function maybeRequestApproval(prompt) {
    const policy = settings.approval;
    const lower = prompt.toLowerCase();
    const requestsFeature = /\b(add|build|create|implement|feature|redesign)\b/.test(lower);
    const hasAlternative = /\b(architecture|approach|refactor|migrate|database|framework)\b/.test(lower);

    if (policy === "none") return { approved: true, selection: "autonomous" };
    if (policy === "everything") {
      return showApprovalDialog(
        "Approve this run",
        "Electron will ask the active model council to analyze the request and may generate a code artifact.",
        [
          ["full", "Use the full council", "Run all enabled specialists and cross-review the result."],
          ["lead", "Lead model only", "Use ChatGPT 5.5 for a faster, lower-cost pass."],
        ],
      );
    }
    if (policy === "alternatives" && hasAlternative) {
      return showApprovalDialog(
        "Choose a project approach",
        "This request has meaningful architectural alternatives. Pick the direction Electron should prioritize.",
        [
          ["conservative", "Conservative", "Preserve the current stack and minimize migration risk."],
          ["balanced", "Balanced", "Improve the design while keeping operational complexity controlled."],
          ["ambitious", "Ambitious", "Prioritize capability and long-term flexibility over migration cost."],
        ],
      );
    }
    if (policy === "features" && requestsFeature) {
      return showApprovalDialog(
        "Approve suggested scope",
        "Electron may propose supporting features needed to make the requested feature complete.",
        [
          ["strict", "Strict request only", "Do exactly what was asked and avoid adjacent features."],
          ["supporting", "Allow supporting features", "Include small additions that materially improve the result."],
        ],
      );
    }
    return { approved: true, selection: "policy-cleared" };
  }

  function showApprovalDialog(title, description, choices) {
    return new Promise((resolve) => {
      els.approvalTitle.textContent = title;
      els.approvalDescription.textContent = description;
      els.approvalChoices.textContent = "";
      choices.forEach(([value, label, detail], index) => {
        const choice = document.createElement("label");
        choice.className = "approval-choice";
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "approvalChoice";
        radio.value = value;
        radio.checked = index === 0;
        const strong = document.createElement("strong");
        strong.textContent = label;
        const copy = document.createElement("p");
        copy.textContent = detail;
        choice.append(radio, strong, copy);
        els.approvalChoices.appendChild(choice);
      });

      const closeHandler = () => {
        const selected = els.approvalChoices.querySelector("input:checked")?.value || "";
        const approved = els.approvalModal.returnValue === "approve";
        resolve({ approved, selection: selected });
        els.approvalModal.removeEventListener("close", closeHandler);
      };
      els.approvalModal.addEventListener("close", closeHandler);
      els.approvalModal.returnValue = "cancel";
      els.approvalModal.showModal();
    });
  }

  async function requestBackend(prompt, attachments, approvalSelection, signal) {
    const base = settings.backendUrl.replace(/\/+$/, "");
    const selectedModels =
      approvalSelection === "lead" ? ["gpt-5.5"] : activeModelIds();
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(settings.accessToken
          ? { Authorization: `Bearer ${settings.accessToken}` }
          : {}),
      },
      body: JSON.stringify({
        prompt,
        attachments,
        messages: getActiveChat().messages.slice(-30).map(({ role, content }) => ({
          role,
          content,
        })),
        models: selectedModels,
        effort: settings.effort,
        approvalPolicy: settings.approval,
        approvalSelection,
        editorTarget: settings.editorTarget,
      }),
      signal,
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(payload.error || `Backend returned ${response.status}`);
    }
    if (!payload.answer) {
      throw new Error("Backend response did not include an answer.");
    }
    return payload;
  }

  async function readJsonResponse(response) {
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return { error: text.slice(0, 240) || "Invalid backend response" };
    }
  }

  async function createDemoResult(prompt, approvalSelection, signal) {
    await delay(1450, signal);
    const wantsCode = /\b(code|build|create|website|app|javascript|html|css|component|api|fix|implement)\b/i.test(
      prompt,
    );
    const answer = wantsCode
      ? [
          "**Demo council complete.** The interface, approval flow, editor handoff, and local chat history are working.",
          "",
          "I prepared a small code artifact to demonstrate the website editor. Connect the included Worker backend to replace this deterministic demo with real parallel responses from the enabled providers.",
          "",
          `Run profile: \`${settings.effort}\` effort, \`${activeModelIds().length}\` active models, approval choice \`${approvalSelection}\`.`,
          "",
          "The production orchestration uses ChatGPT 5.5 for synthesis, Claude Opus 4.8 for independent review, and the remaining specialists for architecture, implementation, research, and diversity checks.",
        ].join("\n")
      : [
          "**Electron is ready in demo mode.** Your request was saved locally and passed through the configured approval policy.",
          "",
          "Connect the Cloudflare Worker from **Connection** to send this prompt to the real model council. API keys never belong in this GitHub Pages frontend.",
          "",
          `Current profile: \`${settings.effort}\` effort with \`${activeModelIds().length}\` active specialists.`,
        ].join("\n");

    const artifact = wantsCode
      ? {
          filename: "electron-output.html",
          language: "html",
          content: demoArtifact(prompt),
        }
      : null;
    return {
      answer,
      artifact,
      meta: `Demo mode · ${settings.effort} effort`,
    };
  }

  function demoArtifact(prompt) {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Electron AI Artifact</title>
    <style>
      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        background: #061126;
        color: #eef5ff;
        font: 16px/1.6 system-ui, sans-serif;
      }
      main {
        width: min(640px, calc(100% - 48px));
        padding: 40px;
        border: 1px solid #244772;
        border-radius: 20px;
        background: #0b1b37;
      }
      strong { color: #64a8ff; }
    </style>
  </head>
  <body>
    <main>
      <strong>Electron AI demo artifact</strong>
      <h1>Your workspace is connected.</h1>
      <p>${escapeHtml(prompt).slice(0, 240)}</p>
    </main>
  </body>
</html>`;
  }

  function setRunning(isRunning) {
    els.runBanner.hidden = !isRunning;
    els.sendButton.disabled = isRunning;
    els.promptInput.disabled = isRunning;
    if (!isRunning) {
      window.clearInterval(statusTimer);
      statusTimer = null;
      els.runStatus.textContent = "Assembling the council";
    }
  }

  function cycleRunStatus() {
    const statuses = [
      "Assembling the council",
      "Specialists are working in parallel",
      "Claude is reviewing the implementation",
      "Codex is verifying the revision",
      "Synthesizing the final answer",
    ];
    let index = 0;
    els.runStatus.textContent = statuses[index];
    statusTimer = window.setInterval(() => {
      index = Math.min(index + 1, statuses.length - 1);
      els.runStatus.textContent = statuses[index];
    }, 1300);
  }

  function stopRun() {
    if (activeRun) {
      activeRun.controller.abort();
      activeRun = null;
      showToast("Run stopped");
    }
    setRunning(false);
  }

  function delay(milliseconds, signal) {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(resolve, milliseconds);
      signal?.addEventListener(
        "abort",
        () => {
          window.clearTimeout(timeout);
          reject(new DOMException("Run stopped", "AbortError"));
        },
        { once: true },
      );
    });
  }

  function openEditor(artifact) {
    els.editorFilename.textContent = artifact.filename || "electron-output.txt";
    els.codeEditor.value = artifact.content || "";
    els.editorDrawer.classList.add("open");
    updateLineNumbers();
    els.editorState.textContent = "Ready";
  }

  function closeEditor() {
    els.editorDrawer.classList.remove("open");
  }

  function handleEditorInput() {
    const chat = getActiveChat();
    if (!chat?.artifact) {
      chat.artifact = {
        filename: els.editorFilename.textContent,
        language: "text",
        content: els.codeEditor.value,
      };
    } else {
      chat.artifact.content = els.codeEditor.value;
    }
    chat.updatedAt = new Date().toISOString();
    saveState();
    els.editorState.textContent = "Saved locally";
    updateLineNumbers();
  }

  function updateLineNumbers() {
    const lines = Math.max(1, els.codeEditor.value.split("\n").length);
    els.lineNumbers.textContent = Array.from({ length: lines }, (_, index) => index + 1).join(
      "\n",
    );
  }

  function syncEditorScroll() {
    els.lineNumbers.scrollTop = els.codeEditor.scrollTop;
  }

  function handleEditorKeys(event) {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const start = els.codeEditor.selectionStart;
    const end = els.codeEditor.selectionEnd;
    els.codeEditor.setRangeText("  ", start, end, "end");
    handleEditorInput();
  }

  async function copyEditorCode() {
    await copyText(els.codeEditor.value);
    showToast("Code copied");
  }

  function downloadEditorCode() {
    const filename = safeFilename(els.editorFilename.textContent);
    const blob = new Blob([els.codeEditor.value], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    showToast(`${filename} downloaded`);
  }

  async function openInVsCode() {
    const artifact = {
      filename: safeFilename(els.editorFilename.textContent),
      content: els.codeEditor.value,
    };
    if (window.electronAI?.openInVSCode) {
      await window.electronAI.openInVSCode(artifact);
      showToast("Sent to VS Code through the local Electron bridge.");
      return;
    }
    downloadEditorCode();
    window.setTimeout(() => {
      window.location.href = "vscode://";
    }, 250);
    showToast("Downloaded the file and requested VS Code. Open the file from Downloads.");
  }

  function safeFilename(name) {
    return (name || "electron-output.txt").replace(/[^a-zA-Z0-9._-]/g, "-");
  }

  function openSettings() {
    els.backendUrl.value = settings.backendUrl;
    els.accessToken.value = settings.accessToken;
    updateConnectionTest(
      settings.backendUrl
        ? "Backend configured. Test it before saving changes."
        : "Demo mode is active. No external requests are sent.",
      Boolean(settings.backendUrl),
    );
    els.settingsModal.showModal();
  }

  function saveConnection(event) {
    event.preventDefault();
    if (event.submitter?.value === "cancel") {
      els.settingsModal.close("cancel");
      return;
    }
    settings.backendUrl = els.backendUrl.value.trim().replace(/\/+$/, "");
    settings.accessToken = els.accessToken.value.trim();
    saveSettings();
    els.settingsModal.close();
    renderConnectionState();
    showToast(settings.backendUrl ? "Backend connection saved" : "Demo mode enabled");
  }

  async function testConnection() {
    const url = els.backendUrl.value.trim().replace(/\/+$/, "");
    if (!url) {
      updateConnectionTest("Enter a backend URL first.", false);
      return;
    }
    updateConnectionTest("Testing secure connection…", false);
    try {
      const response = await fetch(`${url}/api/health`, {
        headers: els.accessToken.value.trim()
          ? { Authorization: `Bearer ${els.accessToken.value.trim()}` }
          : {},
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      updateConnectionTest(
        `Connected. ${payload.modelsConfigured ?? 0} provider model(s) configured.`,
        true,
      );
    } catch (error) {
      updateConnectionTest(`Connection failed: ${error.message}`, false);
    }
  }

  function updateConnectionTest(message, connected) {
    els.connectionTest.querySelector("span:last-child").textContent = message;
    els.connectionTest.querySelector(".status-dot").classList.toggle("connected", connected);
  }

  function renderConnectionState() {
    const connected = Boolean(settings.backendUrl);
    els.connectionLabel.textContent = connected ? "Backend configured" : "Demo mode";
    els.connectionDot.classList.toggle("connected", connected);
  }

  function openSidebar() {
    els.sidebar.classList.add("open");
    els.sidebarBackdrop.classList.add("open");
  }

  function closeSidebar() {
    els.sidebar.classList.remove("open");
    els.sidebarBackdrop.classList.remove("open");
  }

  function formatRelativeTime(value) {
    const date = new Date(value);
    const elapsed = Date.now() - date.getTime();
    const minutes = Math.floor(elapsed / 60_000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  function formatClock(value) {
    return new Date(value).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function safeMarkdown(input) {
    const escaped = escapeHtml(input);
    const codeBlocks = [];
    const withPlaceholders = escaped.replace(/```([\w-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const index = codeBlocks.length;
      codeBlocks.push(
        `<pre><code${lang ? ` data-language="${lang}"` : ""}>${code.trim()}</code></pre>`,
      );
      return `@@CODEBLOCK_${index}@@`;
    });

    let html = withPlaceholders
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
      .split(/\n{2,}/)
      .map((block) => {
        if (/^@@CODEBLOCK_\d+@@$/.test(block.trim())) return block.trim();
        return `<p>${block.replace(/\n/g, "<br>")}</p>`;
      })
      .join("");

    codeBlocks.forEach((block, index) => {
      html = html.replace(`<p>@@CODEBLOCK_${index}@@</p>`, block);
      html = html.replace(`@@CODEBLOCK_${index}@@`, block);
    });
    return html;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("show");
    toastTimer = window.setTimeout(() => els.toast.classList.remove("show"), 2600);
  }
})();
