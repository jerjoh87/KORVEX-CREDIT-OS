#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const endpoint = "https://stitch.googleapis.com/mcp";

function getApiKey() {
  if (process.env.STITCH_API_KEY) return process.env.STITCH_API_KEY;

  const claudeConfigPath = path.join(os.homedir(), ".claude.json");
  const config = JSON.parse(fs.readFileSync(claudeConfigPath, "utf8"));
  const key = config?.mcpServers?.stitch?.headers?.["X-Goog-Api-Key"];

  if (!key) {
    throw new Error(
      "No Stitch API key found. Set STITCH_API_KEY or connect Stitch in ~/.claude.json.",
    );
  }

  return key;
}

function parseResponse(body) {
  const trimmed = body.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("{")) return JSON.parse(trimmed);

  const events = trimmed
    .split(/\n\n+/)
    .flatMap((event) =>
      event
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim()),
    )
    .filter(Boolean)
    .map((data) => JSON.parse(data));

  return events.at(-1) ?? null;
}

async function post(message, sessionId) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "X-Goog-Api-Key": getApiKey(),
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Stitch MCP ${response.status}: ${body}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  let payload = null;

  if (contentType.includes("text/event-stream") && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split(/\r?\n\r?\n+/);
      buffer = events.pop() ?? "";

      for (const event of events) {
        const parsed = parseResponse(event);
        if (parsed && (message.id === undefined || parsed.id === message.id)) {
          payload = parsed;
          await reader.cancel();
          break;
        }
      }

      if (payload) break;
    }
  } else {
    const body = await response.text();
    payload = parseResponse(body);
  }

  return {
    payload,
    sessionId: response.headers.get("mcp-session-id") ?? sessionId,
  };
}

async function main() {
  const command = process.argv[2];
  const toolName = process.argv[3];
  const rawArgs = process.argv[4] ?? "{}";

  let result;
  if (command === "list-tools" || command === "tool-names") {
    result = await post(
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    );
    if (command === "tool-names") {
      result.payload = (result.payload?.result?.tools ?? []).map((tool) => tool.name);
    }
  } else if (command === "schema" && toolName) {
    result = await post(
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    );
    const tools = result.payload?.result?.tools ?? [];
    result.payload = tools.find((tool) => tool.name === toolName) ?? null;
  } else if (command === "call" && toolName) {
    result = await post(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: toolName, arguments: JSON.parse(rawArgs) },
      },
    );
  } else {
    throw new Error(
      "Usage: stitch-mcp.mjs list-tools | schema <tool-name> | call <tool-name> '<json-args>'",
    );
  }

  process.stdout.write(`${JSON.stringify(result.payload, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
