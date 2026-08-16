#!/usr/bin/env node
/**
 * 配置自检：不打印任何密钥原文，只报告是否可用。
 *
 *   node scripts/check-env.mjs
 *
 * 检查项：
 *   1. .env 是否存在、是否被 git 忽略
 *   2. LLM 四个变量是否齐全，并对 DeepSeek 发一次最小请求
 *   3. RQData 许可证是否填写、Bridge 是否在监听
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.join(PROJECT_ROOT, ".env");

function readDotEnv() {
  if (!existsSync(ENV_FILE)) return null;
  const values = {};
  for (const rawLine of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return values;
}

const marks = { ok: "[ok]  ", warn: "[warn]", fail: "[fail]" };
let failed = false;
function report(level, message) {
  if (level === "fail") failed = true;
  console.log(`${marks[level]} ${message}`);
}

const env = readDotEnv();
if (!env) {
  report("fail", ".env 不存在。执行 cp .env.example .env 后填写密钥。");
  process.exit(1);
}
report("ok", ".env 已存在");

const ignored = spawnSync("git", ["check-ignore", "-q", ".env"], { cwd: PROJECT_ROOT }).status === 0;
report(ignored ? "ok" : "fail", ignored ? ".env 已被 git 忽略" : ".env 未被 git 忽略，存在泄露风险");

// ---------- LLM ----------
const llmKeys = ["LLM_PROVIDER", "LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"];
const missingLlm = llmKeys.filter((key) => !env[key]);
if (missingLlm.length) {
  report("warn", `LLM 未配置完整，缺少 ${missingLlm.join(", ")}；应用会回落到离线 Fixture Provider。`);
} else if (env.LLM_PROVIDER !== "deepseek" && env.LLM_PROVIDER !== "remote") {
  report("fail", `LLM_PROVIDER=${env.LLM_PROVIDER} 不会启用远程模型，只能是 deepseek 或 remote。`);
} else {
  report("ok", `LLM 变量齐全（provider=${env.LLM_PROVIDER}, model=${env.LLM_MODEL}）`);
  const endpoint = `${env.LLM_BASE_URL.replace(/\/+$/, "")}/chat/completions`;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.LLM_API_KEY}` },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: env.LLM_MODEL,
        messages: [{ role: "user", content: '返回 JSON：{"ok":true}' }],
        response_format: { type: "json_object" },
        stream: false,
      }),
    });
    if (response.ok) {
      const body = await response.json();
      report("ok", `LLM 连通，实际返回模型 ${body.model ?? env.LLM_MODEL}`);
    } else if (response.status === 401) {
      report("fail", "LLM 返回 401：API Key 无效。");
    } else if (response.status === 402) {
      report("fail", "LLM 返回 402：账户余额不足。");
    } else if (response.status === 404) {
      report("fail", `LLM 返回 404：模型名 ${env.LLM_MODEL} 或 BASE_URL 不正确。`);
    } else {
      report("fail", `LLM 返回 HTTP ${response.status}。`);
    }
  } catch (error) {
    report("fail", `LLM 请求失败：${error instanceof Error ? error.message : error}`);
  }
}

// ---------- RQData ----------
if (!env.RQSDK_LICENSE_KEY) {
  report("warn", "RQSDK_LICENSE_KEY 为空；标的搜索会回落到 Mock Provider。");
} else {
  report("ok", "RQSDK_LICENSE_KEY 已填写");
}

if (env.MARKET_DATA_PROVIDER !== "ricequant") {
  report("warn", `MARKET_DATA_PROVIDER=${env.MARKET_DATA_PROVIDER ?? "(未设置)"}，不会启用 RQData。`);
}

const bridgeUrl = (env.RICEQUANT_BRIDGE_URL || "http://127.0.0.1:8765").replace(/\/+$/, "");
try {
  const response = await fetch(`${bridgeUrl}/health`, { signal: AbortSignal.timeout(5_000) });
  const body = await response.json();
  report(response.ok ? "ok" : "fail", `RQData Bridge ${bridgeUrl} 响应：${JSON.stringify(body)}`);
} catch {
  report("warn", `RQData Bridge ${bridgeUrl} 未在监听。另开一个终端执行 npm run rqdata:start。`);
}

process.exit(failed ? 1 : 0);
