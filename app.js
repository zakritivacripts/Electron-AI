(() => {
  "use strict";

  const STORAGE_KEY = "electron-ai-state-v1";
  const SETTINGS_KEY = "electron-ai-settings-v1";
  const MAX_ATTACHMENT_BYTES = 120_000;
  const MAX_GITHUB_FILE_BYTES = 1_000_000;
  const MAX_REPOSITORY_CONTEXT_BYTES = 120_000;
  const MAX_REPOSITORY_CONTEXT_FILES = 10;
  const MAX_GITHUB_COMMIT_FILES = 50;
  const MAX_GITHUB_COMMIT_BYTES = 5_000_000;
  const GITHUB_API_VERSION = "2022-11-28";

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
  let backendConnection = {
    status: settings.backendUrl ? "configured" : "offline",
    url: settings.backendUrl,
    availableModels: [],
    credentialToken: "",
  };
  let testedConnection = null;
  let githubConnection = {
    status: settings.githubRepository ? "configured" : "offline",
    repository: settings.githubRepository,
    branch: settings.githubBranch,
    credentialToken: "",
  };
  let testedGitHubConnection = null;
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
      "githubRepository",
      "githubBranch",
      "githubToken",
      "testGitHubConnection",
      "githubConnectionTest",
      "agentStatusLabel",
      "welcomeDescription",
      "composerNote",
      "approvalModal",
      "approvalTitle",
      "approvalDescription",
      "approvalPreview",
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
    els.testGitHubConnection.addEventListener("click", testGitHubConnection);
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
      githubRepository: "",
      githubBranch: "main",
      githubToken: "",
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
      return {
        ...defaultSettings(),
        ...(parsed || {}),
        accessToken: "",
        githubToken: "",
      };
    } catch {
      return defaultSettings();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function saveSettings() {
    const {
      accessToken: _sessionOnlyToken,
      githubToken: _sessionOnlyGitHubToken,
      ...persistedSettings
    } = settings;
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
    const selectedModels = activeModelIds();
    const connected = backendConnection.status === "connected";
    const availableModels = connected
      ? selectedModels.filter((modelId) =>
          backendConnection.availableModels.includes(modelId),
        )
      : [];
    const count = availableModels.length;
    const ring = document.querySelector(".summary-ring span");
    const ringLabel = document.querySelector(".summary-ring small");
    const summary = document.querySelector(".council-summary strong");
    const summaryCopy = document.querySelector(".council-summary p");
    if (ring) ring.textContent = connected ? String(count) : "0";
    if (ringLabel) ringLabel.textContent = connected ? "ACTIVE" : "OFFLINE";
    if (summary) {
      summary.textContent = connected
        ? count === MODELS.length
          ? "Full council enabled"
          : `${count} specialists enabled`
        : "Council preview only";
    }
    if (summaryCopy) {
      summaryCopy.textContent = connected
        ? "Each configured model contributes where it is strongest."
        : "Connect a backend before model requests can run.";
    }
    els.toggleAllModels.textContent = count === MODELS.length ? "Disable all" : "Enable all";
    els.agentStatusLabel.textContent = connected
      ? `${count} agent${count === 1 ? "" : "s"} configured`
      : backendConnection.status === "configured"
        ? "Backend not connected"
        : "Offline demo";
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
        path: file.webkitRelativePath || file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
      };
      if (file.size <= MAX_GITHUB_FILE_BYTES && isReadableText(file)) {
        attachment.text = await file.text();
      } else if (file.size <= MAX_GITHUB_FILE_BYTES) {
        attachment.contentBase64 = arrayBufferToBase64(await file.arrayBuffer());
      }
      pendingFiles.push(attachment);
    }
    els.attachmentCount.textContent = pendingFiles.length
      ? `${pendingFiles.length} file${pendingFiles.length === 1 ? "" : "s"}`
      : "";
    if (files.some((file) => file.size > MAX_GITHUB_FILE_BYTES)) {
      showToast("Files larger than 1 MB are attached as metadata only.");
    }
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
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

    const repositoryIntent = isRepositoryContextIntent(prompt);
    const repositoryWrite = isGitHubWriteIntent(prompt);
    const pagesRequested = wantsGitHubPages(prompt);
    if (repositoryIntent && githubConnection.status !== "connected") {
      addMessage(chat, {
        role: "assistant",
        content: [
          "**GitHub repository access is not connected.**",
          "",
          "Open **Connection**, enter the destination as `owner/repository`, choose the branch, add a fine-grained GitHub token, and run **Test GitHub access**.",
          "",
          repositoryWrite
            ? "No files were committed and no repository setting was changed."
            : "Electron did not inspect repository files, so it will not pretend it reviewed the project.",
        ].join("\n"),
        meta: "GitHub connection required",
      });
      saveState();
      render();
      return;
    }

    const directPublish = repositoryWrite && isDirectRepositoryPublishIntent(prompt);
    const directFiles = directPublish ? commitFilesFromAttachments(attachments) : [];
    const currentArtifact =
      directPublish && !directFiles.length && chat.artifact?.content
        ? commitFileFromArtifact(chat.artifact)
        : null;
    const pagesConfigurationOnly =
      pagesRequested &&
      !/\b(build|create|implement|fix|redesign|write|generate)\b/i.test(prompt);
    const directRepositoryAction =
      repositoryWrite &&
      (directFiles.length > 0 || currentArtifact || pagesConfigurationOnly);
    const approval = directRepositoryAction
      ? { approved: true, selection: "policy-cleared" }
      : await maybeRequestApproval(prompt);
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
      let repositoryContext = [];
      let repositoryBaseBranch = null;
      if (
        repositoryIntent &&
        (!repositoryWrite || (settings.backendUrl && !directRepositoryAction))
      ) {
        els.runStatus.textContent = "Reading repository context...";
        const repositoryRead = await loadRepositoryContext(
          Math.max(0, MAX_REPOSITORY_CONTEXT_FILES - attachments.length),
          prompt,
          run.controller.signal,
        );
        repositoryContext = repositoryRead.attachments;
        repositoryBaseBranch = repositoryRead.branch;
      }

      let result;
      if (repositoryWrite) {
        const files = directFiles.length
          ? directFiles
          : currentArtifact
            ? [currentArtifact]
            : [];
        if (files.length || pagesConfigurationOnly) {
          result = await publishGitHubChanges(
            prompt,
            files,
            pagesRequested,
            run.controller.signal,
          );
        } else if (settings.backendUrl && requestsMultipleGeneratedFiles(prompt)) {
          result = {
            answer: [
              "**Nothing was committed.**",
              "",
              "This request appears to require several generated files. Electron currently commits multiple attached files, but model-generated repository changes are limited to one complete file per approved run.",
              "",
              "Attach the complete file set for a direct import, or narrow the request to one repository-relative file.",
            ].join("\n"),
            meta: "Multi-file change requires attachments",
          };
        } else if (settings.backendUrl) {
          els.runStatus.textContent = "Preparing repository change...";
          const prepared = await requestBackend(
            prompt,
            [...attachments, ...repositoryContext],
            approval.selection,
            run.controller.signal,
            "prepare-artifact",
          );
          if (!prepared.artifact?.content) {
            result = {
              answer: [
                prepared.answer,
                "",
                "**Nothing was committed.** The model did not return a complete file artifact for review.",
              ].join("\n"),
              meta: prepared.meta,
            };
          } else {
            const published = await publishGitHubChanges(
              prompt,
              [commitFileFromArtifact(prepared.artifact)],
              pagesRequested,
              run.controller.signal,
              repositoryBaseBranch,
            );
            result = {
              ...published,
              answer: `${prepared.answer}\n\n${published.answer}`,
              artifact: prepared.artifact,
              meta: `${prepared.meta} · GitHub commit`,
            };
          }
        } else {
          result = {
            answer: [
              "**Nothing was committed.**",
              "",
              "Attach the files to import, keep a generated artifact open in this chat, or connect the model backend so Electron can prepare a repository change.",
            ].join("\n"),
            meta: "Repository input required",
          };
        }
      } else if (settings.backendUrl) {
        result = await requestBackend(
          prompt,
          [...attachments, ...repositoryContext],
          approval.selection,
          run.controller.signal,
        );
      } else if (repositoryIntent) {
        result = repositoryReadResult(repositoryContext);
      } else {
        result = await createDemoResult(
          prompt,
          approval.selection,
          run.controller.signal,
        );
      }

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
        if (
          error.source !== "github" &&
          settings.backendUrl &&
          (!error.status ||
            error.status === 401 ||
            error.status === 403 ||
            error.status >= 500)
        ) {
          backendConnection = {
            status: "configured",
            url: settings.backendUrl,
            availableModels: [],
            credentialToken: "",
          };
          renderConnectionState();
        }
        if (
          error.source === "github" &&
          (!error.status || error.status === 401 || error.status === 403)
        ) {
          githubConnection = {
            status: settings.githubRepository ? "configured" : "offline",
            repository: settings.githubRepository,
            branch: settings.githubBranch,
            credentialToken: "",
          };
          renderConnectionState();
        }
        addMessage(chat, {
          role: "assistant",
          content:
            error.source === "github"
              ? `The GitHub operation did not complete.\n\n\`${error.message || "Unknown GitHub error"}\`\n\nNo forced branch update was attempted. Check the repository, branch, token permissions, and branch protection rules, then try again.`
              : `The council could not complete this run.\n\n\`${error.message || "Unknown connection error"}\`\n\nYour message is saved. Check the backend URL, access token, provider keys, and Worker logs, then try again.`,
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

  function isRepositoryContextIntent(prompt) {
    return /\b(github|repository|repo|codebase|project files?|github pages)\b|github\.com\//i.test(
      prompt,
    );
  }

  function isGitHubWriteIntent(prompt) {
    const action =
      /\b(commit|push|import|upload|publish|deploy|enable|write|modify|change|update|add|fix|implement|create|move|copy|work)\b/i.test(
        prompt,
      );
    const target =
      /\b(github|repository|repo|branch|github pages|pages site)\b|github\.com\//i.test(
        prompt,
      );
    return action && target;
  }

  function wantsGitHubPages(prompt) {
    return /\b(github pages|pages site|enable pages|deploy(?:ment)? to pages|publish(?:ed)? (?:it |this |the site )?to pages)\b/i.test(
      prompt,
    );
  }

  function isDirectRepositoryPublishIntent(prompt) {
    return /\b(import|upload|push|publish|deploy|copy|move)\b/i.test(prompt);
  }

  function requestsMultipleGeneratedFiles(prompt) {
    return (
      requestedRepositoryPaths(prompt).length > 1 ||
      /\b(multiple|several|all|entire|whole)\s+(?:project\s+)?files?\b|\bfiles\b|\bfull (?:website|site|app|application|project)\b/i.test(
        prompt,
      )
    );
  }

  function commitFilesFromAttachments(attachments) {
    if (!attachments.length) return [];
    const rawPaths = attachments.map((attachment) =>
      String(attachment.path || attachment.name || ""),
    );
    const firstSegments = rawPaths
      .filter((path) => path.includes("/") || path.includes("\\"))
      .map((path) => path.replace(/\\/g, "/").split("/")[0]);
    const stripRoot =
      firstSegments.length === rawPaths.length &&
      new Set(firstSegments).size === 1;

    return attachments
      .filter(
        (attachment) =>
          typeof attachment.text === "string" || attachment.contentBase64,
      )
      .map((attachment) => {
        let path = String(attachment.path || attachment.name || "");
        if (stripRoot) path = path.replace(/\\/g, "/").split("/").slice(1).join("/");
        return {
          path: safeGitHubPath(path),
          ...(typeof attachment.text === "string"
            ? { content: attachment.text, encoding: "utf-8" }
            : {
                content: attachment.contentBase64,
                encoding: "base64",
              }),
        };
      });
  }

  function commitFileFromArtifact(artifact) {
    return {
      path: safeGitHubPath(artifact.filename || "electron-output.txt"),
      content: String(artifact.content || ""),
      encoding: "utf-8",
    };
  }

  function safeGitHubPath(value) {
    const path = String(value || "").trim().replace(/\\/g, "/");
    if (
      !path ||
      path.length > 240 ||
      path.startsWith("/") ||
      path.endsWith("/") ||
      path.split("/").some((part) => !part || part === "." || part === "..")
    ) {
      const error = new Error(`Invalid repository path: ${value || "(empty)"}`);
      error.source = "github";
      throw error;
    }
    return path;
  }

  function prepareBackendAttachments(attachments) {
    let remaining = MAX_ATTACHMENT_BYTES;
    return attachments.slice(0, 12).map((attachment) => {
      const text = String(attachment.text || "").slice(0, remaining);
      remaining -= text.length;
      return {
        name: String(attachment.name || attachment.path || "attachment").slice(0, 180),
        type: String(attachment.type || "text/plain").slice(0, 100),
        size: Math.max(0, Number(attachment.size) || text.length),
        text,
      };
    });
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

  function showApprovalDialog(title, description, choices, previewFiles = []) {
    return new Promise((resolve) => {
      els.approvalTitle.textContent = title;
      els.approvalDescription.textContent = description;
      renderApprovalPreview(previewFiles);
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

  function renderApprovalPreview(files) {
    els.approvalPreview.textContent = "";
    els.approvalPreview.hidden = !files.length;
    files.forEach((file, index) => {
      const details = document.createElement("details");
      details.open = index === 0;
      const summary = document.createElement("summary");
      summary.textContent = `${file.path} · ${file.byteSize.toLocaleString()} bytes · SHA-256 ${file.sha256}${
        file.encoding === "base64" ? " · binary" : ""
      }`;
      const pre = document.createElement("pre");
      if (file.encoding === "base64") {
        pre.textContent =
          `Binary file selected from your device. Exact SHA-256: ${file.sha256}`;
      } else {
        const content = String(file.content || "");
        pre.textContent = content || "[empty file]";
      }
      details.append(summary, pre);
      els.approvalPreview.appendChild(details);
    });
  }

  async function requestBackend(
    prompt,
    attachments,
    approvalSelection,
    signal,
    taskMode = "answer",
  ) {
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
        attachments: prepareBackendAttachments(attachments),
        messages: getActiveChat().messages.slice(-30).map(({ role, content }) => ({
          role,
          content,
        })),
        models: selectedModels,
        effort: settings.effort,
        approvalPolicy: settings.approval,
        approvalSelection,
        editorTarget: taskMode === "prepare-artifact" ? "web" : settings.editorTarget,
        taskMode,
      }),
      signal,
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      const error = new Error(payload.error || `Backend returned ${response.status}`);
      error.status = response.status;
      throw error;
    }
    if (!payload.answer) {
      throw new Error("Backend response did not include an answer.");
    }
    backendConnection = {
      status: "connected",
      url: base,
      availableModels: Array.isArray(payload.agents)
        ? payload.agents
            .filter((agent) => agent.status === "completed")
            .map((agent) => agent.modelId)
        : [],
      credentialToken: settings.accessToken,
    };
    renderConnectionState();
    return payload;
  }

  function parseGitHubRepository(value) {
    let repository = String(value || "").trim();
    repository = repository
      .replace(/^git@github\.com:/i, "")
      .replace(/^https?:\/\/github\.com\//i, "")
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "")
      .replace(/\.git$/i, "");
    const match = repository.match(
      /^([a-z0-9](?:[a-z0-9-]{0,38}))\/([a-z0-9._-]+)$/i,
    );
    if (!match) {
      const error = new Error("Use a GitHub repository in owner/name format.");
      error.source = "github";
      throw error;
    }
    return {
      owner: match[1],
      repo: match[2],
      fullName: `${match[1]}/${match[2]}`,
    };
  }

  function normalizeGitHubBranch(value) {
    const branch = String(value || "main").trim();
    if (
      !branch ||
      branch.length > 180 ||
      !/^[a-zA-Z0-9._/-]+$/.test(branch) ||
      branch.includes("..") ||
      branch.includes("//") ||
      branch.startsWith("/") ||
      branch.endsWith("/") ||
      branch.endsWith(".")
    ) {
      const error = new Error("The GitHub branch name is invalid.");
      error.source = "github";
      throw error;
    }
    return branch;
  }

  function githubCredentials(connection = githubConnection) {
    const parsed = parseGitHubRepository(connection.repository);
    return {
      ...parsed,
      branch: normalizeGitHubBranch(connection.branch),
      token: connection.credentialToken || settings.githubToken,
    };
  }

  async function githubApi(path, options = {}, credentials = githubCredentials()) {
    const response = await fetch(`https://api.github.com${path}`, {
      ...options,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        ...(credentials.token
          ? { Authorization: `Bearer ${credentials.token}` }
          : {}),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      const error = new Error(
        payload.message ||
          payload.error ||
          `GitHub returned HTTP ${response.status}`,
      );
      error.status = response.status;
      error.source = "github";
      throw error;
    }
    return payload;
  }

  async function getGitHubBranch(credentials = githubCredentials(), signal) {
    return githubApi(
      `/repos/${encodeURIComponent(credentials.owner)}/${encodeURIComponent(
        credentials.repo,
      )}/branches/${encodeURIComponent(credentials.branch)}`,
      { signal },
      credentials,
    );
  }

  async function loadRepositoryContext(maxFiles, prompt, signal) {
    if (maxFiles <= 0) return { attachments: [], branch: null };
    const credentials = githubCredentials();
    const branch = await getGitHubBranch(credentials, signal);
    if (signal?.aborted) throw new DOMException("Run stopped", "AbortError");
    const treeSha = branch.commit?.commit?.tree?.sha;
    if (!treeSha) {
      const error = new Error("GitHub did not return the branch tree.");
      error.source = "github";
      throw error;
    }
    const tree = await githubApi(
      `/repos/${encodeURIComponent(credentials.owner)}/${encodeURIComponent(
        credentials.repo,
      )}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`,
      { signal },
      credentials,
    );
    const textEntries = (tree.tree || []).filter(isRepositoryTextEntry);
    const requestedPaths = requestedRepositoryPaths(prompt);
    const missingPaths = requestedPaths.filter(
      (requestedPath) =>
        !textEntries.some(
          (entry) => entry.path.toLowerCase() === requestedPath.toLowerCase(),
        ),
    );
    if (missingPaths.length) {
      const error = new Error(
        `The requested repository file was not found: ${missingPaths.join(", ")}`,
      );
      error.source = "github";
      throw error;
    }
    if (tree.truncated && !requestedPaths.length) {
      const error = new Error(
        "GitHub returned a truncated repository tree. Narrow the request to exact file paths.",
      );
      error.source = "github";
      throw error;
    }
    const requestedPathSet = new Set(requestedPaths.map((path) => path.toLowerCase()));
    const candidates = textEntries
      .filter(isRepositoryTextEntry)
      .sort((left, right) => {
        const leftRequested = requestedPathSet.has(left.path.toLowerCase()) ? 1 : 0;
        const rightRequested = requestedPathSet.has(right.path.toLowerCase()) ? 1 : 0;
        return (
          rightRequested - leftRequested ||
          repositoryContextScore(right) - repositoryContextScore(left)
        );
      })
      .slice(0, Math.min(maxFiles, MAX_REPOSITORY_CONTEXT_FILES));

    const attachments = [];
    let remaining = MAX_REPOSITORY_CONTEXT_BYTES;
    for (const entry of candidates) {
      if (signal?.aborted) throw new DOMException("Run stopped", "AbortError");
      if (remaining <= 0) break;
      const blob = await githubApi(
        `/repos/${encodeURIComponent(credentials.owner)}/${encodeURIComponent(
          credentials.repo,
        )}/git/blobs/${encodeURIComponent(entry.sha)}`,
        { signal },
        credentials,
      );
      const text = decodeGitHubBlob(blob).slice(0, remaining);
      remaining -= text.length;
      attachments.push({
        name: entry.path,
        path: entry.path,
        type: "text/plain",
        size: entry.size || text.length,
        text,
        source: "github",
      });
    }
    return { attachments, branch };
  }

  function requestedRepositoryPaths(prompt) {
    const matches = String(prompt || "").match(
      /(?:^|[\s`"'(])([a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*\.(?:js|jsx|mjs|cjs|ts|tsx|html|css|scss|json|md|txt|py|go|rs|java|yml|yaml|toml|xml|sh|ps1))(?=$|[\s`"',):])/gi,
    );
    return [
      ...new Set(
        (matches || []).map((match) =>
          match.trim().replace(/^[`"'(]+|[`"',):]+$/g, ""),
        ),
      ),
    ].slice(0, MAX_REPOSITORY_CONTEXT_FILES);
  }

  function isRepositoryTextEntry(entry) {
    if (
      entry.type !== "blob" ||
      !entry.path ||
      !entry.sha ||
      entry.size > 80_000 ||
      /(^|\/)(node_modules|vendor|dist|build|coverage|\.git)(\/|$)/i.test(entry.path) ||
      /\.(lock|map|min\.js|min\.css|png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|eot)$/i.test(
        entry.path,
      )
    ) {
      return false;
    }
    return /(^|\/)(readme|license)(\.[^/]+)?$|\.(js|jsx|mjs|cjs|ts|tsx|html|css|scss|json|md|txt|py|go|rs|java|yml|yaml|toml|xml|sh|ps1)$/i.test(
      entry.path,
    );
  }

  function repositoryContextScore(entry) {
    const path = entry.path.toLowerCase();
    let score = 0;
    if (/(^|\/)readme(\.|$)/.test(path)) score += 100;
    if (/(^|\/)(package\.json|wrangler\.toml|vite\.config|next\.config)/.test(path)) {
      score += 80;
    }
    if (/(^|\/)(index|app|main)\.(js|jsx|ts|tsx|html|py)$/.test(path)) score += 60;
    score -= path.split("/").length * 2;
    score -= Math.min(Number(entry.size) || 0, 80_000) / 10_000;
    return score;
  }

  function decodeGitHubBlob(blob) {
    if (blob.encoding !== "base64") return String(blob.content || "");
    const binary = atob(String(blob.content || "").replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }

  function repositoryReadResult(repositoryContext) {
    if (!repositoryContext.length) {
      return {
        answer:
          "Electron reached the configured repository, but no supported text files fit the context limits. Connect the model backend and narrow the request to specific files.",
        meta: "GitHub repository read",
      };
    }
    const files = repositoryContext.map((file) => `- \`${file.name}\``).join("\n");
    return {
      answer: [
        `Electron read ${repositoryContext.length} file${
          repositoryContext.length === 1 ? "" : "s"
        } from \`${githubConnection.repository}@${githubConnection.branch}\`:`,
        "",
        files,
        "",
        "The model backend is not connected, so no AI review or code change was attempted.",
      ].join("\n"),
      meta: "GitHub repository read · model offline",
    };
  }

  async function publishGitHubChanges(
    prompt,
    files,
    pagesRequested,
    signal,
    baseBranch = null,
  ) {
    const credentials = githubCredentials();
    const approvedBranch = baseBranch || (await getGitHubBranch(credentials, signal));
    const approvedHeadSha = approvedBranch.commit?.sha;
    if (!approvedHeadSha) {
      const error = new Error("GitHub did not return the branch head for approval.");
      error.source = "github";
      throw error;
    }
    const preparedFiles = await addCommitFingerprints(
      mergeCommitFiles(
        pagesRequested ? [...files, ...githubPagesFiles(credentials.branch)] : files,
      ),
    );
    if (!preparedFiles.length) {
      const error = new Error("There are no complete files to commit.");
      error.source = "github";
      throw error;
    }
    if (preparedFiles.length > MAX_GITHUB_COMMIT_FILES) {
      const error = new Error(
        `A single approved commit is limited to ${MAX_GITHUB_COMMIT_FILES} files.`,
      );
      error.source = "github";
      throw error;
    }
    const totalBytes = preparedFiles.reduce(
      (total, file) => total + file.byteSize,
      0,
    );
    if (totalBytes > MAX_GITHUB_COMMIT_BYTES) {
      const error = new Error(
        `A single approved commit is limited to ${MAX_GITHUB_COMMIT_BYTES.toLocaleString()} bytes.`,
      );
      error.source = "github";
      throw error;
    }

    const fileList = preparedFiles.map((file) => file.path).join(", ");
    const pagesAction = pagesRequested
      ? "\nRepository setting: set GitHub Pages build type to workflow"
      : "";
    const approval = await showApprovalDialog(
      "Approve GitHub commit",
      `Repository: ${credentials.fullName}\nBranch: ${
        credentials.branch
      }\nApproved head: ${approvedHeadSha}\nFiles (${
        preparedFiles.length
      }): ${fileList}${pagesAction}`,
      [
        [
          "commit",
          "Commit these exact files",
          "Create one commit and update the branch only if it remains a fast-forward.",
        ],
      ],
      preparedFiles,
    );
    if (!approval.approved) {
      return {
        answer: "GitHub commit canceled. No repository files or Pages settings were changed.",
        meta: "GitHub approval declined",
      };
    }

    els.runStatus.textContent = "Creating approved GitHub commit...";
    const commit = await createGitHubCommit(
      credentials,
      preparedFiles,
      githubCommitMessage(prompt),
      signal,
      approvedBranch,
    );
    let pages = null;
    let pagesWarning = "";
    if (pagesRequested) {
      els.runStatus.textContent = "Enabling GitHub Pages...";
      try {
        pages = await configureGitHubPages(credentials, signal);
      } catch (error) {
        pagesWarning = `\n\nThe commit succeeded, but Pages setup failed: \`${error.message}\``;
      }
    }
    const pagesLine = pages?.html_url
      ? `\n\nPages: [${pages.html_url}](${pages.html_url})`
      : pagesRequested && !pagesWarning
        ? "\n\nGitHub Pages is configured for the committed workflow."
        : "";
    return {
      answer: [
        `Committed ${preparedFiles.length} file${
          preparedFiles.length === 1 ? "" : "s"
        } to \`${credentials.fullName}@${credentials.branch}\`.`,
        "",
        `Commit: [${commit.sha.slice(0, 7)}](${commit.htmlUrl})${pagesLine}${pagesWarning}`,
      ].join("\n"),
      meta: "GitHub commit completed",
    };
  }

  function mergeCommitFiles(files) {
    const byPath = new Map();
    files.forEach((file) => {
      byPath.set(safeGitHubPath(file.path), {
        path: safeGitHubPath(file.path),
        content: String(file.content ?? ""),
        encoding: file.encoding === "base64" ? "base64" : "utf-8",
      });
    });
    return [...byPath.values()];
  }

  async function addCommitFingerprints(files) {
    return Promise.all(
      files.map(async (file) => {
        const bytes =
          file.encoding === "base64"
            ? base64ToBytes(file.content)
            : new TextEncoder().encode(file.content);
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        return {
          ...file,
          byteSize: bytes.byteLength,
          sha256: [...new Uint8Array(digest)]
            .map((value) => value.toString(16).padStart(2, "0"))
            .join(""),
        };
      }),
    );
  }

  function base64ToBytes(value) {
    const binary = atob(String(value || "").replace(/\s/g, ""));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function githubPagesFiles(branch) {
    return [
      {
        path: ".github/workflows/electron-pages.yml",
        encoding: "utf-8",
        content: [
          "name: Deploy site to GitHub Pages",
          "",
          "on:",
          "  push:",
          `    branches: [${JSON.stringify(branch)}]`,
          "  workflow_dispatch:",
          "",
          "permissions:",
          "  contents: read",
          "  pages: write",
          "  id-token: write",
          "",
          "concurrency:",
          "  group: pages",
          "  cancel-in-progress: true",
          "",
          "jobs:",
          "  deploy:",
          "    environment:",
          "      name: github-pages",
          "      url: ${{ steps.deployment.outputs.page_url }}",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - uses: actions/checkout@v4",
          "      - uses: actions/configure-pages@v6",
          "      - uses: actions/upload-pages-artifact@v5",
          "        with:",
          "          path: .",
          "      - id: deployment",
          "        uses: actions/deploy-pages@v5",
          "",
        ].join("\n"),
      },
      {
        path: ".nojekyll",
        content: "",
        encoding: "utf-8",
      },
    ];
  }

  function githubCommitMessage(prompt) {
    const summary = String(prompt || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 56);
    return `Electron AI: ${summary || "update repository"}`;
  }

  async function createGitHubCommit(
    credentials,
    files,
    message,
    signal,
    branch,
  ) {
    const parentSha = branch.commit?.sha;
    const baseTree = branch.commit?.commit?.tree?.sha;
    if (!parentSha || !baseTree) {
      const error = new Error("GitHub did not return the current branch commit.");
      error.source = "github";
      throw error;
    }
    const repositoryPath = `/repos/${encodeURIComponent(
      credentials.owner,
    )}/${encodeURIComponent(credentials.repo)}`;
    const treeEntries = [];
    for (const file of files) {
      if (signal?.aborted) throw new DOMException("Run stopped", "AbortError");
      const blob = await githubApi(
        `${repositoryPath}/git/blobs`,
        {
          method: "POST",
          signal,
          body: JSON.stringify({
            content: file.content,
            encoding: file.encoding,
          }),
        },
        credentials,
      );
      treeEntries.push({
        path: file.path,
        mode: "100644",
        type: "blob",
        sha: blob.sha,
      });
    }
    if (signal?.aborted) throw new DOMException("Run stopped", "AbortError");
    const tree = await githubApi(
      `${repositoryPath}/git/trees`,
      {
        method: "POST",
        signal,
        body: JSON.stringify({
          base_tree: baseTree,
          tree: treeEntries,
        }),
      },
      credentials,
    );
    if (signal?.aborted) throw new DOMException("Run stopped", "AbortError");
    const commit = await githubApi(
      `${repositoryPath}/git/commits`,
      {
        method: "POST",
        signal,
        body: JSON.stringify({
          message,
          tree: tree.sha,
          parents: [parentSha],
        }),
      },
      credentials,
    );
    if (signal?.aborted) throw new DOMException("Run stopped", "AbortError");
    lockRunFinalization(signal);
    await githubApi(
      `${repositoryPath}/git/refs/heads/${encodeURIComponent(credentials.branch)}`,
      {
        method: "PATCH",
        signal,
        body: JSON.stringify({ sha: commit.sha, force: false }),
      },
      credentials,
    );
    return {
      sha: commit.sha,
      htmlUrl:
        commit.html_url ||
        `https://github.com/${credentials.fullName}/commit/${commit.sha}`,
    };
  }

  async function configureGitHubPages(credentials, signal) {
    const repositoryPath = `/repos/${encodeURIComponent(
      credentials.owner,
    )}/${encodeURIComponent(credentials.repo)}/pages`;
    let exists = false;
    try {
      await githubApi(repositoryPath, { signal }, credentials);
      exists = true;
    } catch (error) {
      if (error.status !== 404) throw error;
    }
    if (exists) {
      if (signal?.aborted) throw new DOMException("Run stopped", "AbortError");
      await githubApi(
        repositoryPath,
        {
          method: "PUT",
          signal,
          body: JSON.stringify({ build_type: "workflow" }),
        },
        credentials,
      );
    } else {
      if (signal?.aborted) throw new DOMException("Run stopped", "AbortError");
      await githubApi(
        repositoryPath,
        {
          method: "POST",
          signal,
          body: JSON.stringify({ build_type: "workflow" }),
        },
        credentials,
      );
    }
    return githubApi(repositoryPath, { signal }, credentials);
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
    await delay(650, signal);
    const intent = classifyOfflineIntent(prompt);
    const answer = createOfflineAnswer(prompt, intent, approvalSelection);
    const artifact = intent === "code"
      ? {
          filename: "electron-output.html",
          language: "html",
          content: demoArtifact(prompt),
        }
      : null;
    return {
      answer,
      artifact,
      meta: `Offline demo · ${intent}`,
    };
  }

  function classifyOfflineIntent(prompt) {
    const lower = prompt.toLowerCase();
    if (
      /\bgithub\b|github\.com|github\s+pages|\bgit\s+repository\b/.test(lower)
    ) {
      return "github";
    }
    if (
      /\b(repository|repo|pages|push|commit|deploy|publish|clone|import|upload)\b/.test(
        lower,
      )
    ) {
      return "external";
    }
    if (/\b(debug|bug|error|broken|fails?|fix|repair)\b/.test(lower)) return "debug";
    if (
      /\b(code|build|create|website|app|javascript|html|css|component|api|implement)\b/.test(
        lower,
      )
    ) {
      return "code";
    }
    if (/\b(research|compare|investigate|source|evidence|latest)\b/.test(lower)) {
      return "research";
    }
    return "general";
  }

  function createOfflineAnswer(prompt, intent, approvalSelection) {
    const request = summarizeRequest(prompt);
    const profile = `Selected profile: \`${settings.effort}\` effort, approval \`${approvalSelection}\`.`;

    if (intent === "github") {
      const repository = extractGitHubRepository(prompt);
      return [
        "**GitHub action not executed.** Electron is currently running as an offline browser demo.",
        "",
        `I understood the request as: ${request}`,
        "",
        repository
          ? `Detected repository: \`${repository}\`.`
          : "No complete `owner/repository` target was detected in the message.",
        "",
        "This static page has no GitHub login, repository filesystem, terminal, or write-capable GitHub tool. It cannot truthfully clone, commit, push, enable Pages, or verify a deployment. The current Worker handles model text generation only; connecting it does not add GitHub write access.",
        "",
        "**Required execution path**",
        "",
        "1. Add a GitHub App or OAuth integration with explicit repository permission.",
        "2. Upload or generate the project files to be committed.",
        "3. Show the exact repository, branch, files, and commit message for approval.",
        "4. Commit and push through the authorized backend.",
        "5. Enable GitHub Pages and verify the live URL.",
        "",
        `${profile} Nothing was changed on GitHub.`,
      ].join("\n");
    }

    if (intent === "external") {
      return [
        "**External action not executed.** Electron is currently running as an offline browser demo.",
        "",
        `I understood the request as: ${request}`,
        "",
        "This page has no authenticated deployment, repository, cloud, filesystem, or data-import tool. I will not label a generic deployment or import as a GitHub operation, and I will not claim it succeeded.",
        "",
        "Connect an execution backend that exposes the specific destination as an authorized tool, then require approval for the exact target and payload.",
        "",
        `${profile} No external system was changed.`,
      ].join("\n");
    }

    if (intent === "debug") {
      return [
        "**Offline debugging preview.**",
        "",
        `Request received: ${request}`,
        "",
        "I cannot inspect a runtime or repository in demo mode. Attach the relevant source files and error output, or connect an execution backend that can read the project. I will not claim a fix was applied when no files or tools were available.",
        "",
        profile,
      ].join("\n");
    }

    if (intent === "code") {
      return [
        "**Offline code preview created.**",
        "",
        `Request received: ${request}`,
        "",
        "I generated a small local HTML artifact so you can test the website editor. This is a prompt-specific preview, not a model-generated implementation and not a repository change.",
        "",
        "For a real build, connect the model backend and provide the project files. Repository publishing still requires a separate authorized GitHub integration.",
        "",
        profile,
      ].join("\n");
    }

    if (intent === "research") {
      return [
        "**Research was not run.**",
        "",
        `Request received: ${request}`,
        "",
        "Offline demo mode has no model or web-research connection, so it cannot gather or verify evidence. Connect the backend before relying on a research answer.",
        "",
        profile,
      ].join("\n");
    }

    return [
      "**Offline demo response.**",
      "",
      `I received: ${request}`,
      "",
      "No AI model is connected, so I will not manufacture an answer or repeat a canned claim that agents completed the task. Open **Connection** to configure the model backend.",
      "",
      profile,
    ].join("\n");
  }

  function summarizeRequest(prompt) {
    const clean = prompt.replace(/\s+/g, " ").trim();
    const summary = clean.length > 220 ? `${clean.slice(0, 219)}…` : clean;
    return `“${summary}”`;
  }

  function extractGitHubRepository(prompt) {
    const urlMatch = prompt.match(
      /github\.com\/([a-z0-9_.-]+)\/([a-z0-9_.-]+?)(?:\.git)?(?:[/?#\s]|$)/i,
    );
    if (urlMatch) return `${urlMatch[1]}/${urlMatch[2]}`;
    const slugMatch = prompt.match(
      /\b([a-z0-9_.-]+)\/([a-z0-9_.-]+)\b/i,
    );
    return slugMatch ? `${slugMatch[1]}/${slugMatch[2]}` : "";
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
    els.stopRunButton.disabled = !isRunning;
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
      if (activeRun.cancelLocked) {
        showToast("The approved GitHub update is finalizing and can no longer be stopped.");
        return;
      }
      activeRun.controller.abort();
      activeRun = null;
      showToast("Run stopped");
    }
    setRunning(false);
  }

  function lockRunFinalization(signal) {
    if (!activeRun || activeRun.controller.signal !== signal) return;
    activeRun.cancelLocked = true;
    els.stopRunButton.disabled = true;
    els.runStatus.textContent = "Finalizing approved GitHub changes...";
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
    testedConnection = null;
    testedGitHubConnection = null;
    els.backendUrl.value = settings.backendUrl;
    els.accessToken.value = settings.accessToken;
    els.githubRepository.value = settings.githubRepository;
    els.githubBranch.value = settings.githubBranch || "main";
    els.githubToken.value = settings.githubToken;
    updateConnectionTest(
      backendConnection.status === "connected"
        ? "Saved backend passed its authenticated connection test."
        : settings.backendUrl
          ? "Backend configured. Test it before saving changes."
        : "Demo mode is active. No external requests are sent.",
      backendConnection.status === "connected",
    );
    updateGitHubConnectionTest(
      githubConnection.status === "connected"
        ? `Connected to ${githubConnection.repository}@${githubConnection.branch}.`
        : settings.githubRepository
          ? "Repository configured. Test access before saving changes."
          : "GitHub repository access is not configured.",
      githubConnection.status === "connected",
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
    settings.githubRepository = els.githubRepository.value.trim();
    settings.githubBranch = els.githubBranch.value.trim() || "main";
    settings.githubToken = els.githubToken.value.trim();
    const testedConnectionMatches =
      testedConnection?.status === "connected" &&
      testedConnection.url === settings.backendUrl &&
      testedConnection.credentialToken === settings.accessToken;
    backendConnection = testedConnectionMatches
      ? { ...testedConnection }
      : {
          status: settings.backendUrl ? "configured" : "offline",
          url: settings.backendUrl,
          availableModels: [],
          credentialToken: "",
        };
    const testedGitHubConnectionMatches =
      testedGitHubConnection?.status === "connected" &&
      testedGitHubConnection.repository === settings.githubRepository &&
      testedGitHubConnection.branch === settings.githubBranch &&
      testedGitHubConnection.credentialToken === settings.githubToken;
    githubConnection = testedGitHubConnectionMatches
      ? { ...testedGitHubConnection }
      : {
          status: settings.githubRepository ? "configured" : "offline",
          repository: settings.githubRepository,
          branch: settings.githubBranch,
          credentialToken: "",
        };
    testedConnection = null;
    testedGitHubConnection = null;
    saveSettings();
    els.settingsModal.close();
    renderConnectionState();
    showToast(
      settings.backendUrl || settings.githubRepository
        ? "Connections saved"
        : "Offline demo enabled",
    );
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
      testedConnection = {
        status: "connected",
        url,
        availableModels: Array.isArray(payload.availableModels)
          ? payload.availableModels
          : [],
        credentialToken: els.accessToken.value.trim(),
      };
    } catch (error) {
      testedConnection = {
        status: "configured",
        url,
        availableModels: [],
        credentialToken: "",
      };
      updateConnectionTest(`Connection failed: ${error.message}`, false);
    }
  }

  function updateConnectionTest(message, connected) {
    els.connectionTest.querySelector("span:last-child").textContent = message;
    els.connectionTest.querySelector(".status-dot").classList.toggle("connected", connected);
  }

  async function testGitHubConnection() {
    let parsed;
    let branch;
    const token = els.githubToken.value.trim();
    try {
      parsed = parseGitHubRepository(els.githubRepository.value);
      if (!token) throw new Error("Enter a fine-grained GitHub token first.");
      const repository = await githubApi(
        `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`,
        {},
        {
          ...parsed,
          branch: "main",
          token,
        },
      );
      branch = normalizeGitHubBranch(
        els.githubBranch.value.trim() || repository.default_branch || "main",
      );
      const credentials = {
        ...parsed,
        branch,
        token,
      };
      updateGitHubConnectionTest("Testing repository and branch access...", false);
      const branchResult = await getGitHubBranch(credentials);
      els.githubRepository.value = parsed.fullName;
      els.githubBranch.value = branch;
      testedGitHubConnection = {
        status: "connected",
        repository: parsed.fullName,
        branch,
        credentialToken: token,
        headSha: branchResult.commit?.sha || "",
      };
      updateGitHubConnectionTest(
        `Connected to ${parsed.fullName}@${branch}. Repository and branch are readable; write permission is checked when a commit is approved.`,
        true,
      );
    } catch (error) {
      testedGitHubConnection = {
        status: "configured",
        repository: parsed?.fullName || els.githubRepository.value.trim(),
        branch: branch || els.githubBranch.value.trim() || "main",
        credentialToken: "",
      };
      updateGitHubConnectionTest(`GitHub access failed: ${error.message}`, false);
    }
  }

  function updateGitHubConnectionTest(message, connected) {
    els.githubConnectionTest.querySelector("span:last-child").textContent = message;
    els.githubConnectionTest
      .querySelector(".status-dot")
      .classList.toggle("connected", connected);
  }

  function renderConnectionState() {
    const backendConnected = backendConnection.status === "connected";
    const githubConnected = githubConnection.status === "connected";
    const configured =
      backendConnection.status === "configured" ||
      githubConnection.status === "configured";
    els.connectionLabel.textContent =
      backendConnected && githubConnected
        ? "AI + GitHub connected"
        : githubConnected
          ? "GitHub connected"
          : backendConnected
            ? "Backend connected"
            : configured
              ? "Configured, not connected"
              : "Offline demo";
    els.connectionDot.classList.toggle(
      "connected",
      backendConnected || githubConnected,
    );
    document
      .querySelector(".live-status")
      .classList.toggle("offline", !backendConnected && !githubConnected);
    els.councilPanel.classList.toggle("offline", !backendConnected);
    els.welcomeDescription.textContent =
      backendConnected && githubConnected
        ? "Electron can inspect the connected repository, prepare model-reviewed changes, and commit exact files after your approval."
        : githubConnected
          ? "GitHub is connected for repository reads and approved commits. Connect the model backend for AI review and generated changes."
          : backendConnected
            ? "Electron routes requests through the configured model council. Connect GitHub separately for repository reads and approved commits."
            : configured
              ? "A connection is saved but has not passed its authenticated test. Open Connection and test it before relying on it."
              : "This is an offline interface preview. Connect the model backend for AI and GitHub for repository work.";
    els.composerNote.textContent =
      backendConnected && githubConnected
        ? "Repository writes always require approval of the exact branch and files."
        : githubConnected
          ? "GitHub connected. AI changes require the separate model backend."
          : backendConnected
            ? "Model backend connected. GitHub repository actions are not connected."
            : configured
              ? "Connection configured but not authenticated in this page session."
              : "Offline demo: no models, repository writes, or external tools are running.";
    updateModelSummary();
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
