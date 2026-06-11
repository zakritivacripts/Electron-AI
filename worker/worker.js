const MODEL_REGISTRY = {
  "gpt-5.5": {
    provider: "openai",
    role: "Lead engineer and systems synthesizer",
  },
  "claude-opus-4-8": {
    provider: "anthropic",
    role: "Independent principal-level reviewer",
  },
  "claude-opus-4-7": {
    provider: "anthropic",
    role: "Architecture and long-horizon agent specialist",
  },
  "claude-opus-4-6": {
    provider: "anthropic",
    role: "Risk analysis and implementation planner",
  },
  "gemini-3.1-pro-preview": {
    provider: "gemini",
    role: "Research, multimodal, and tool-use specialist",
  },
  "qwen3.7-max": {
    provider: "qwen",
    role: "Independent reasoning and alternative-solutions specialist",
  },
  "claude-sonnet-4-6": {
    provider: "anthropic",
    role: "Fast implementation and pragmatic coding specialist",
  },
};

const DEFAULT_MODELS = Object.keys(MODEL_REGISTRY);
const MAX_PROMPT_CHARS = 24_000;
const MAX_HISTORY_MESSAGES = 30;
const MAX_ATTACHMENT_CHARS = 120_000;
const MAX_REQUEST_BYTES = 500_000;
const PROVIDER_TIMEOUT_MS = 90_000;
const MAX_CONCURRENT_REQUESTS = 2;
const activeRequests = new Map();

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    try {
      assertOriginAllowed(origin, env);
      const clientKey = authorize(request, env);

      if (request.method === "GET" && url.pathname === "/api/health") {
        return json(
          {
            ok: true,
            service: "electron-ai-orchestrator",
            modelsConfigured: configuredModels(env).length,
            availableModels: configuredModels(env),
            timestamp: new Date().toISOString(),
          },
          200,
          cors,
        );
      }

      if (request.method === "POST" && url.pathname === "/api/chat") {
        await enforceRateLimit(clientKey, env);
        const releaseSlot = acquireRequestSlot(clientKey);
        try {
          const payload = await readJsonBody(request);
          const result = await orchestrate(payload, env);
          return json(result, 200, cors);
        } finally {
          releaseSlot();
        }
      }

      return json({ error: "Route not found" }, 404, cors);
    } catch (error) {
      const status = Number(error.status) || 500;
      const message = status === 500 ? "The orchestration service failed." : error.message;
      console.error("Electron AI request failed", {
        status,
        message: error.message,
        stack: error.stack,
      });
      return json(
        {
          error: message,
          requestId: request.headers.get("cf-ray") || crypto.randomUUID(),
        },
        status,
        cors,
      );
    }
  },
};

async function orchestrate(payload, env) {
  const input = validatePayload(payload);
  const externalAction = detectExternalActionRequest(input);
  if (externalAction && input.taskMode !== "prepare-artifact") {
    return {
      answer: safeExternalActionResponse(externalAction),
      artifact: null,
      meta: "External action unavailable",
      agents: [],
      failures: [],
      capabilities: {
        externalActionsAvailable: false,
        externalActionsExecuted: false,
      },
    };
  }
  const requestedModels =
    input.approvalSelection === "lead"
      ? ["gpt-5.5"]
      : input.models.filter((id) => MODEL_REGISTRY[id]);
  const available = configuredModels(env);
  const models = requestedModels.filter((id) => available.includes(id));

  if (!models.length) {
    throw httpError(
      503,
      "None of the requested models are configured. Add provider secrets to the Worker.",
    );
  }

  const context = formatContext(input);
  const specialistRuns = await Promise.allSettled(
    models.map(async (modelId) => {
      const registry = MODEL_REGISTRY[modelId];
      const system = [
        "You are one specialist inside Electron AI's model council.",
        `Your assigned strength: ${registry.role}.`,
        "Analyze the user's request independently. Be concrete, technically accurate, and concise.",
        "The newest CURRENT REQUEST is authoritative. Answer that request directly instead of repeating a prior assistant response.",
        "Call out assumptions, risks, and a recommended implementation.",
        "You have no repository, shell, browser, deployment, or GitHub-write tool in this service.",
        "Never claim that you cloned, imported, committed, pushed, deployed, enabled Pages, or changed files.",
        "For external-action requests, distinguish clearly between a proposed plan and an action that was actually executed.",
        input.taskMode === "prepare-artifact"
          ? "The browser has a separately authorized GitHub integration. Prepare the requested complete file artifact for later user approval, but do not claim it was committed."
          : "Return an answer for the user; only create an artifact when code is requested.",
        `Approval policy: ${input.approvalPolicy}; approved direction: ${input.approvalSelection}.`,
      ].join("\n");
      const text = await callModel(modelId, system, context, input.effort, env);
      return { modelId, role: registry.role, text };
    }),
  );

  const contributions = [];
  const failures = [];
  specialistRuns.forEach((run, index) => {
    const modelId = models[index];
    if (run.status === "fulfilled") {
      contributions.push(run.value);
    } else {
      failures.push({
        modelId,
        error: safeProviderError(run.reason),
      });
    }
  });

  if (!contributions.length) {
    throw httpError(502, "Every configured provider failed for this request.");
  }

  let draft = contributions[0].text;
  try {
    draft = await synthesizeDraft(contributions, input, context, env, models);
  } catch (error) {
    failures.push({ modelId: "synthesis", error: safeProviderError(error) });
  }

  let reviewResult = {
    text: "No independent review was available for this run.",
    modelId: null,
  };
  try {
    reviewResult = await reviewDraft(draft, input, context, env, models);
  } catch (error) {
    failures.push({ modelId: "review", error: safeProviderError(error) });
  }

  let finalResult = { text: draft, modelId: null };
  try {
    finalResult = await verifyFinal(
      draft,
      reviewResult.text,
      input,
      context,
      env,
      models,
    );
  } catch (error) {
    failures.push({ modelId: "verification", error: safeProviderError(error) });
  }
  let final = finalResult.text;
  let correctiveRewrite = false;
  const previousAssistant = [...input.messages]
    .reverse()
    .find((message) => message.role === "assistant")?.content;
  const retryModel =
    finalResult.modelId ||
    contributions.find((contribution) =>
      models.includes(contribution.modelId),
    )?.modelId ||
    null;
  if (
    previousAssistant &&
    isNearDuplicate(final, previousAssistant) &&
    retryModel
  ) {
    try {
      final = await callModel(
        retryModel,
        [
          "Answer the newest user request directly.",
          "Your previous draft duplicated the earlier assistant response.",
          "Produce a materially different answer specific to the current request.",
          "Do not claim external actions were executed; this service has no repository or deployment tools.",
          artifactInstructions(input.editorTarget, input.taskMode),
        ].join("\n"),
        `${context}\n\nDUPLICATED RESPONSE TO AVOID:\n${truncate(previousAssistant, 12_000)}`,
        input.effort,
        env,
      );
      correctiveRewrite = true;
    } catch (error) {
      failures.push({ modelId: "deduplication", error: safeProviderError(error) });
    }
  }
  const artifact = extractArtifact(final, input.editorTarget, input.taskMode);
  const crossReviewed =
    !correctiveRewrite &&
    MODEL_REGISTRY[reviewResult.modelId]?.provider === "anthropic" &&
    finalResult.modelId === "gpt-5.5";

  return {
    answer: artifact ? removeArtifactBlock(final, artifact.content) : final,
    artifact,
    meta: `${contributions.length} agents · ${input.effort} effort${
      crossReviewed ? " · cross-reviewed" : ""
    }`,
    agents: contributions.map(({ modelId, role }) => ({
      modelId,
      role,
      status: "completed",
    })),
    failures,
    capabilities: {
      externalActionsAvailable: false,
      externalActionsExecuted: false,
    },
  };
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw httpError(400, "Request body must be JSON.");
  }
  const prompt = String(payload.prompt || "").trim();
  if (!prompt) throw httpError(400, "Prompt is required.");
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw httpError(413, `Prompt exceeds ${MAX_PROMPT_CHARS} characters.`);
  }

  const effort = ["fast", "balanced", "max"].includes(payload.effort)
    ? payload.effort
    : "balanced";
  const approvalPolicy = ["everything", "alternatives", "features", "none"].includes(
    payload.approvalPolicy,
  )
    ? payload.approvalPolicy
    : "alternatives";
  const editorTarget = ["web", "vscode", "response"].includes(payload.editorTarget)
    ? payload.editorTarget
    : "response";
  const taskMode = payload.taskMode === "prepare-artifact"
    ? "prepare-artifact"
    : "answer";
  const approvalSelection = String(
    payload.approvalSelection || "policy-cleared",
  ).slice(0, 80);
  validateApprovalSelection(approvalPolicy, approvalSelection);

  return {
    prompt,
    effort,
    approvalPolicy,
    approvalSelection,
    editorTarget,
    taskMode,
    models: Array.isArray(payload.models)
      ? [...new Set(payload.models.map(String))].slice(0, DEFAULT_MODELS.length)
      : DEFAULT_MODELS,
    messages: Array.isArray(payload.messages)
      ? payload.messages.slice(-MAX_HISTORY_MESSAGES).map((message) => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: String(message.content || "").slice(0, MAX_PROMPT_CHARS),
        }))
      : [],
    attachments: normalizeAttachments(payload.attachments),
  };
}

function validateApprovalSelection(policy, selection) {
  const allowed = {
    everything: ["full", "lead"],
    alternatives: ["conservative", "balanced", "ambitious", "policy-cleared"],
    features: ["strict", "supporting", "policy-cleared"],
    none: ["autonomous", "policy-cleared"],
  };
  if (!allowed[policy]?.includes(selection)) {
    throw httpError(400, "Approval selection does not match the approval policy.");
  }
}

function normalizeAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];
  let remainingChars = MAX_ATTACHMENT_CHARS;
  return attachments.slice(0, 12).map((attachment) => {
    const text = String(attachment.text || "").slice(0, remainingChars);
    remainingChars -= text.length;
    return {
      name: String(attachment.name || "attachment").slice(0, 180),
      type: String(attachment.type || "application/octet-stream").slice(0, 100),
      size: Math.max(0, Number(attachment.size) || 0),
      text,
    };
  });
}

function formatContext(input) {
  const history = input.messages
    .slice(0, -1)
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n\n");
  const attachments = input.attachments
    .map((attachment) => {
      const body = attachment.text
        ? `\n--- ${attachment.name} ---\n${attachment.text}`
        : " (binary or metadata-only attachment)";
      return `${attachment.name} [${attachment.type}, ${attachment.size} bytes]${body}`;
    })
    .join("\n\n");

  return [
    history ? `RECENT CONVERSATION:\n${history}` : "",
    attachments ? `ATTACHMENTS:\n${attachments}` : "",
    `CURRENT REQUEST:\n${input.prompt}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function synthesizeDraft(contributions, input, context, env, allowedModels) {
  const transcript = contributions
    .map(
      (item) =>
        `### ${item.modelId} — ${item.role}\n${truncate(item.text, 18_000)}`,
    )
    .join("\n\n");
  const prompt = [
    context,
    "\nCOUNCIL CONTRIBUTIONS:",
    transcript,
    "\nCreate a single implementation-ready draft.",
    "The newest CURRENT REQUEST overrides older conversation goals.",
    "Do not reuse a prior assistant answer unless the user explicitly asks for it.",
    "Reconcile disagreements instead of voting blindly.",
    "Preserve the strongest concrete details and explicitly resolve material risks.",
    artifactInstructions(input.editorTarget, input.taskMode),
  ].join("\n");

  const preferred = pickAvailable(
    ["gpt-5.5", "claude-opus-4-8", "gemini-3.1-pro-preview"],
    env,
    allowedModels,
  );
  if (!preferred) return contributions[0].text;

  return callModel(
    preferred,
    "You are Electron AI's lead synthesizer. Produce the best unified draft from independent specialist work.",
    prompt,
    input.effort,
    env,
  );
}

async function reviewDraft(draft, input, context, env, allowedModels) {
  const reviewer = pickAvailable(
    ["claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6"],
    env,
    allowedModels,
  );
  if (!reviewer) {
    return {
      text: "No Anthropic reviewer was configured; retain the draft and verify it carefully.",
      modelId: null,
    };
  }

  return {
    text: await callModel(
      reviewer,
      [
        "You are the independent Claude reviewer in Electron AI.",
        "Audit the proposed answer as if it were a production pull request.",
        "Prioritize correctness, security, broken assumptions, missing edge cases, and missing verification.",
        "Give precise required revisions. Do not rewrite the whole answer.",
      ].join("\n"),
      `${context}\n\nDRAFT TO REVIEW:\n${truncate(draft, 30_000)}`,
      input.effort,
      env,
    ),
    modelId: reviewer,
  };
}

async function verifyFinal(draft, review, input, context, env, allowedModels) {
  const verifier = pickAvailable(
    ["gpt-5.5", "claude-opus-4-8", "gemini-3.1-pro-preview"],
    env,
    allowedModels,
  );
  if (!verifier) return { text: draft, modelId: null };

  return {
    text: await callModel(
      verifier,
      [
        "You are the final Codex verifier in Electron AI.",
        "Apply every valid review finding, reject incorrect review claims, and return the final user-facing answer.",
        "Answer the newest CURRENT REQUEST, not an older request from conversation history.",
        "Do not repeat an earlier assistant response unless the user explicitly requests repetition.",
        "Never claim repository, GitHub, shell, or deployment actions were executed because this service has no such tools.",
        "Do not mention hidden deliberation or expose chain-of-thought.",
        "Be direct and implementation-ready.",
        artifactInstructions(input.editorTarget, input.taskMode),
      ].join("\n"),
      [
        context,
        `\nDRAFT:\n${truncate(draft, 30_000)}`,
        `\nCLAUDE REVIEW:\n${truncate(review, 18_000)}`,
      ].join("\n"),
      input.effort,
      env,
    ),
    modelId: verifier,
  };
}

function artifactInstructions(editorTarget, taskMode = "answer") {
  if (taskMode === "prepare-artifact") {
    return [
      "Return exactly one primary complete file artifact in a fenced code block.",
      "Put its repository-relative filename on the line immediately before the block using exactly: FILE: path/to/filename.ext",
      "The file must be ready for review and commit; do not claim that it has already been written or committed.",
      "Keep any short explanation outside the fenced block.",
    ].join("\n");
  }
  if (editorTarget === "response") {
    return "Return the answer in Markdown. Include code only when it is needed.";
  }
  return [
    "If code is requested, include one primary complete artifact in a fenced code block.",
    "Put a filename on the line immediately before the block using exactly: FILE: filename.ext",
    "Keep explanation outside the fenced block.",
  ].join("\n");
}

async function callModel(modelId, system, prompt, effort, env) {
  const registration = MODEL_REGISTRY[modelId];
  if (!registration) throw new Error(`Unknown model: ${modelId}`);
  switch (registration.provider) {
    case "openai":
      return callOpenAI(modelId, system, prompt, effort, env);
    case "anthropic":
      return callAnthropic(modelId, system, prompt, effort, env);
    case "gemini":
      return callGemini(modelId, system, prompt, effort, env);
    case "qwen":
      return callQwen(modelId, system, prompt, effort, env);
    default:
      throw new Error(`Unsupported provider: ${registration.provider}`);
  }
}

async function callOpenAI(modelId, system, prompt, effort, env) {
  requireSecret(env.OPENAI_API_KEY, "OPENAI_API_KEY");
  const response = await providerFetch(`${env.OPENAI_BASE_URL || "https://api.openai.com/v1"}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL_ID || modelId,
      instructions: system,
      input: prompt,
      reasoning: { effort: openAIEffort(effort) },
      max_output_tokens: outputBudget(effort, "openai"),
    }),
  });
  const payload = await providerJson(response, "OpenAI");
  const text = (payload.output || [])
    .flatMap((item) => item.content || [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("OpenAI returned no text.");
  return text;
}

async function callAnthropic(modelId, system, prompt, effort, env) {
  requireSecret(env.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY");
  const response = await providerFetch(
    `${env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`,
    {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: anthropicModelId(modelId, env),
        max_tokens: outputBudget(effort, "anthropic"),
        system,
        messages: [{ role: "user", content: prompt }],
        output_config: { effort: anthropicEffort(effort) },
        thinking: { type: "adaptive" },
      }),
    },
  );
  const payload = await providerJson(response, "Anthropic");
  const text = (payload.content || [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("Anthropic returned no text.");
  return text;
}

async function callGemini(modelId, system, prompt, effort, env) {
  requireSecret(env.GEMINI_API_KEY, "GEMINI_API_KEY");
  const model = env.GEMINI_MODEL_ID || modelId;
  const base = env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";
  const response = await providerFetch(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": env.GEMINI_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: outputBudget(effort, "gemini"),
        thinkingConfig: { thinkingLevel: geminiEffort(effort) },
      },
    }),
  });
  const payload = await providerJson(response, "Gemini");
  const text = (payload.candidates || [])
    .flatMap((candidate) => candidate.content?.parts || [])
    .filter((part) => part.text && !part.thought)
    .map((part) => part.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("Gemini returned no text.");
  return text;
}

async function callQwen(modelId, system, prompt, effort, env) {
  requireSecret(env.QWEN_API_KEY, "QWEN_API_KEY");
  const base =
    env.QWEN_BASE_URL ||
    "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
  const response = await providerFetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.QWEN_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.QWEN_MODEL_ID || modelId,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      max_tokens: outputBudget(effort, "qwen"),
      enable_thinking: effort !== "fast",
      thinking_budget: effort === "max" ? 32_768 : effort === "balanced" ? 12_288 : 2_048,
      stream: false,
    }),
  });
  const payload = await providerJson(response, "Qwen");
  const text = payload.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Qwen returned no text.");
  return text;
}

function anthropicModelId(modelId, env) {
  const envKey = `ANTHROPIC_${modelId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_ID`;
  return env[envKey] || modelId;
}

function outputBudget(effort, provider) {
  const base =
    effort === "max" ? 12_000 : effort === "balanced" ? 5_000 : 2_000;
  if (provider === "anthropic" && effort === "max") return 24_000;
  return base;
}

function openAIEffort(effort) {
  return effort === "max" ? "xhigh" : effort === "balanced" ? "high" : "low";
}

function anthropicEffort(effort) {
  return effort === "max" ? "max" : effort === "balanced" ? "high" : "low";
}

function geminiEffort(effort) {
  return effort === "max" ? "high" : effort === "balanced" ? "medium" : "low";
}

function configuredModels(env) {
  return DEFAULT_MODELS.filter((modelId) => {
    const provider = MODEL_REGISTRY[modelId].provider;
    if (provider === "openai") return Boolean(env.OPENAI_API_KEY);
    if (provider === "anthropic") return Boolean(env.ANTHROPIC_API_KEY);
    if (provider === "gemini") return Boolean(env.GEMINI_API_KEY);
    if (provider === "qwen") return Boolean(env.QWEN_API_KEY);
    return false;
  });
}

function pickAvailable(preferences, env, allowedModels = DEFAULT_MODELS) {
  const available = configuredModels(env);
  return (
    preferences.find(
      (model) => available.includes(model) && allowedModels.includes(model),
    ) || null
  );
}

function authorize(request, env) {
  if (!env.ELECTRON_ACCESS_TOKEN) {
    throw httpError(503, "ELECTRON_ACCESS_TOKEN is not configured.");
  }
  const provided = request.headers.get("Authorization") || "";
  if (provided !== `Bearer ${env.ELECTRON_ACCESS_TOKEN}`) {
    throw httpError(401, "Invalid or missing access token.");
  }
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  return `${ip}:${provided.slice(-12)}`;
}

function assertOriginAllowed(origin, env) {
  const allowed = allowedOrigins(env);
  if (!allowed.length || allowed.some((value) => value.includes("REPLACE-WITH"))) {
    throw httpError(503, "ALLOWED_ORIGINS is not configured.");
  }
  if (origin && !allowed.includes(origin)) {
    throw httpError(403, "Origin is not allowed.");
  }
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

async function enforceRateLimit(clientKey, env) {
  if (!env.ELECTRON_RATE_LIMITER?.limit) {
    throw httpError(503, "ELECTRON_RATE_LIMITER is not configured.");
  }
  const { success } = await env.ELECTRON_RATE_LIMITER.limit({ key: clientKey });
  if (!success) {
    throw httpError(429, "Rate limit exceeded. Try again in about one minute.");
  }
}

function acquireRequestSlot(clientKey) {
  const current = activeRequests.get(clientKey) || 0;
  if (current >= MAX_CONCURRENT_REQUESTS) {
    throw httpError(429, "Too many concurrent runs.");
  }
  activeRequests.set(clientKey, current + 1);
  return () => {
    const next = (activeRequests.get(clientKey) || 1) - 1;
    if (next <= 0) activeRequests.delete(clientKey);
    else activeRequests.set(clientKey, next);
  };
}

function corsHeaders(origin, env) {
  const allowed = allowedOrigins(env);
  const allowOrigin =
    !origin || allowed.includes(origin.replace(/\/+$/, "")) ? origin || "*" : "null";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
}

async function readJsonBody(request) {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_REQUEST_BYTES) {
    throw httpError(413, `Request exceeds ${MAX_REQUEST_BYTES} bytes.`);
  }
  if (!request.body) throw httpError(400, "Request body is required.");

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw httpError(413, `Request exceeds ${MAX_REQUEST_BYTES} bytes.`);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw httpError(400, "Request body must contain valid JSON.");
  }
}

async function providerFetch(url, init) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
        await response.arrayBuffer();
        await sleep(450);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt === 0 && error.name !== "AbortError") {
        await sleep(300);
        continue;
      }
      if (error.name === "AbortError") {
        throw new Error("Provider request timed out.");
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error("Provider request failed.");
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function providerJson(response, provider) {
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const detail =
      payload.error?.message ||
      payload.message ||
      text.slice(0, 300) ||
      `${provider} returned HTTP ${response.status}`;
    throw new Error(`${provider}: ${detail}`);
  }
  return payload;
}

function extractArtifact(answer, editorTarget, taskMode = "answer") {
  if (editorTarget === "response") return null;
  const match = answer.match(
    /(?:^|\n)FILE:\s*([^\n]+)\n```([\w.+-]*)\n([\s\S]*?)```/i,
  );
  if (!match) return null;
  return {
    filename:
      taskMode === "prepare-artifact"
        ? safeRepositoryPath(match[1].trim())
        : safeFilename(match[1].trim()),
    language: match[2] || "text",
    content: match[3].trimEnd(),
  };
}

function safeRepositoryPath(value) {
  const parts = String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => safeFilename(part));
  return parts.join("/").slice(0, 240) || "electron-output.txt";
}

function removeArtifactBlock(answer, content) {
  const withoutBlock = answer.replace(
    /(?:^|\n)FILE:\s*[^\n]+\n```[\w.+-]*\n[\s\S]*?```/i,
    "",
  );
  const clean = withoutBlock.trim();
  return clean || `A complete ${inferArtifactType(content)} artifact is ready in the editor.`;
}

function inferArtifactType(content) {
  if (/<!doctype html/i.test(content)) return "HTML";
  if (/\bfunction\b|=>/.test(content)) return "JavaScript";
  return "code";
}

function safeFilename(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "electron-output.txt";
}

function truncate(value, max) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max)}\n[truncated]` : text;
}

function isNearDuplicate(left, right) {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  if (!normalizedLeft || !normalizedRight) return false;
  const shorter =
    normalizedLeft.length <= normalizedRight.length
      ? normalizedLeft
      : normalizedRight;
  const longer =
    normalizedLeft.length > normalizedRight.length
      ? normalizedLeft
      : normalizedRight;
  if (shorter.length >= 80 && longer.includes(shorter)) return true;

  const leftWords = normalizedWordSet(left);
  const rightWords = normalizedWordSet(right);
  if (leftWords.size < 8 || rightWords.size < 8) {
    if (normalizedLeft === normalizedRight) return true;
    const leftNgrams = characterNgrams(normalizedLeft);
    const rightNgrams = characterNgrams(normalizedRight);
    return setContainment(leftNgrams, rightNgrams) >= 0.88;
  }
  let intersection = 0;
  leftWords.forEach((word) => {
    if (rightWords.has(word)) intersection += 1;
  });
  const union = new Set([...leftWords, ...rightWords]).size;
  const smallerSet = Math.min(leftWords.size, rightWords.size);
  const containment = smallerSet > 0 ? intersection / smallerSet : 0;
  const jaccard = union > 0 ? intersection / union : 0;
  return containment >= 0.9 || jaccard >= 0.76;
}

function normalizedWordSet(value) {
  return new Set(
    normalizeText(value)
      .match(/[\p{L}\p{N}]+/gu)
      ?.filter((word) => [...word].length > 1) || [],
  );
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function characterNgrams(value, size = 3) {
  const characters = [...value.replace(/\s+/g, "")];
  const grams = new Set();
  for (let index = 0; index <= characters.length - size; index += 1) {
    grams.add(characters.slice(index, index + size).join(""));
  }
  return grams;
}

function setContainment(left, right) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  left.forEach((value) => {
    if (right.has(value)) intersection += 1;
  });
  return intersection / Math.min(left.size, right.size);
}

function detectExternalActionRequest(input) {
  const current = normalizeText(input.prompt);
  if (asksForInstructions(current)) return null;
  if (containsExternalAction(current)) return input.prompt;

  const followUp =
    /^(do it|proceed|go ahead|continue|execute it|make it happen|yes do it|yes proceed)$/u.test(
      current,
    );
  if (!followUp) return null;

  const previousRequest = [...input.messages]
    .reverse()
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .find(
      (message) =>
        normalizeText(message) !== current &&
        containsExternalAction(normalizeText(message)),
    );
  return previousRequest ? `${previousRequest}\nFollow-up: ${input.prompt}` : null;
}

function asksForInstructions(text) {
  return /^(how|how do|how can|explain|guide|show me how|what are|what is|give me steps|write instructions)\b/u.test(
    text,
  );
}

function containsExternalAction(text) {
  const target =
    /\b(github|repository|repo|pages|deployment|branch|remote)\b/u.test(
      text,
    );
  if (!target) return false;
  const explicitExternalAction =
    /\b(clone|import|commit|push|deploy|publish|enable|upload|move|copy)\b/u.test(
      text,
    );
  if (explicitExternalAction) return true;
  const repositoryMutation =
    /\b(write|change|create|update|modify)\b.{0,60}\b(repository|repo|branch|remote|github pages)\b/u.test(
      text,
    ) ||
    /\b(write|change|create|update|modify)\b.{0,40}\b(to|in|on)\s+github\b/u.test(
      text,
    );
  return repositoryMutation;
}

function safeExternalActionResponse(request) {
  return [
    "**External action not executed.**",
    "",
    `Electron understood the request as: ${String(request).slice(0, 700)}`,
    "",
    "This model service has no repository, GitHub, shell, filesystem, or deployment tool. It cannot truthfully claim that it cloned, imported, committed, pushed, deployed, enabled Pages, or changed files.",
    "",
    "Use a separately authorized execution integration and approve the exact destination, branch, files, and commit before making the change.",
  ].join("\n");
}

function safeProviderError(error) {
  return String(error?.message || error || "Provider failed").slice(0, 220);
}

function requireSecret(value, name) {
  if (!value) throw new Error(`${name} is not configured.`);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function json(payload, status, headers) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
