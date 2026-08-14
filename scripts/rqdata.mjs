#!/usr/bin/env node
/**
 * 跨平台 RQData 环境管理脚本。
 *
 *   node scripts/rqdata.mjs setup   安装 RQSDK 并校验许可证
 *   node scripts/rqdata.mjs start   启动本地 RQData Bridge
 *   node scripts/rqdata.mjs test    跑 Bridge 指标口径测试（不需要许可证）
 *
 * 运行环境优先级：
 *   1. RQDATA_VENV 指向的 venv（macOS / Linux 默认，无需 conda）
 *   2. conda 环境 RQDATA_CONDA_ENV（官方推荐，Windows 默认）
 *   3. 两者都没有时，用系统 Python 自动创建 venv
 *
 * 许可证不写入 shell 配置文件：脚本按官方 uri 规则把 RQSDK_LICENSE_KEY
 * 组装成 RQDATAC2_CONF，只注入子进程环境。
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.join(PROJECT_ROOT, ".env");
const SERVER_FILE = path.join(PROJECT_ROOT, "services", "rqdata_bridge", "server.py");
const RQDATAC_DEFAULT_ADDRESS = "rqdatad-pro.ricequant.com:16011";
const RQSDK_VERSION = "1.7.4";
// rqsdk 1.7.4 依赖 scipy 1.10.1 / numpy 1.26，没有 3.13+ 的预编译轮子。
const PYTHON_CANDIDATES = ["python3.11", "python3.10", "python3.12", "python3.9", "python3", "python"];
const MIN_MINOR = 8;
const MAX_MINOR = 12;

function readDotEnv() {
  if (!existsSync(ENV_FILE)) return {};
  const values = {};
  for (const rawLine of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    values[key] = value;
  }
  return values;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", cwd: PROJECT_ROOT, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} 退出码 ${result.status}`);
  return result;
}

function capture(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", cwd: PROJECT_ROOT });
  if (result.error || result.status !== 0) return null;
  return String(result.stdout || result.stderr || "").trim();
}

function hasCommand(command) {
  return capture(command, ["--version"]) !== null;
}

/** 把 license key、`手机号:密码` 或完整 uri 统一成 rqdatac uri（对齐 rqsdk/license_helper.py）。 */
export function toRqdatacUri(licenseKey) {
  const value = String(licenseKey ?? "").trim();
  if (!value) return "";
  if (/^\w+:\/\//.test(value)) return value;
  const credential = value.includes(":") ? value : `license:${value}`;
  if (credential.includes("/")) throw new Error("RQSDK_LICENSE_KEY 含非法斜线");
  return `tcp://${credential}@${RQDATAC_DEFAULT_ADDRESS}`;
}

function venvPython(venvDir) {
  const posix = path.join(venvDir, "bin", "python");
  const windows = path.join(venvDir, "Scripts", "python.exe");
  if (existsSync(posix)) return posix;
  if (existsSync(windows)) return windows;
  return null;
}

function findSystemPython() {
  for (const candidate of PYTHON_CANDIDATES) {
    const version = capture(candidate, ["-c", "import sys;print(sys.version_info[0],sys.version_info[1])"]);
    if (!version) continue;
    const [major, minor] = version.split(/\s+/).map(Number);
    if (major === 3 && minor >= MIN_MINOR && minor <= MAX_MINOR) return { command: candidate, minor };
  }
  return null;
}

/**
 * 解析可用的 Python 运行方式。
 * create=true 时允许现场创建 venv；create=false 只做发现，供 start 使用。
 */
function resolveRuntime(env, { create }) {
  const venvDir = path.resolve(PROJECT_ROOT, env.RQDATA_VENV || ".venv-rqdata");
  const existing = venvPython(venvDir);
  if (existing) return { kind: "venv", python: existing, venvDir };

  const condaEnv = env.RQDATA_CONDA_ENV || "thesis-keeper-rqdata";
  if (hasCommand("conda")) {
    const envList = capture("conda", ["env", "list", "--json"]);
    const known = envList ? (JSON.parse(envList).envs ?? []) : [];
    if (known.some((item) => path.basename(item) === condaEnv)) {
      return { kind: "conda", condaEnv, python: null };
    }
    if (create) {
      const environmentFile = path.join(PROJECT_ROOT, "environment.rqdata.yml");
      run("conda", ["env", "create", "-f", environmentFile]);
      return { kind: "conda", condaEnv, python: null };
    }
  }

  if (!create) return null;

  const systemPython = findSystemPython();
  if (!systemPython) {
    throw new Error(
      `未找到可用的 Python 3.${MIN_MINOR}–3.${MAX_MINOR}。请安装 Anaconda/Miniconda（官方推荐），或安装 python3.11 后重试。`,
    );
  }
  console.log(`使用 ${systemPython.command} 创建 venv：${venvDir}`);
  run(systemPython.command, ["-m", "venv", venvDir]);
  const created = venvPython(venvDir);
  if (!created) throw new Error("venv 创建失败");
  run(created, ["-m", "pip", "install", "--upgrade", "pip", "-q"]);
  return { kind: "venv", python: created, venvDir };
}

/** 在解析出的运行环境里执行命令。 */
function runInRuntime(runtime, args, options = {}) {
  if (runtime.kind === "venv") return run(runtime.python, args, options);
  return run("conda", ["run", "--no-capture-output", "-n", runtime.condaEnv, "python", ...args], options);
}

function commandSetup(env) {
  const runtime = resolveRuntime(env, { create: true });
  console.log(runtime.kind === "venv" ? `RQData 运行环境：venv ${runtime.venvDir}` : `RQData 运行环境：conda ${runtime.condaEnv}`);

  const installed = runtime.kind === "venv"
    ? capture(runtime.python, ["-c", "import rqdatac;print(rqdatac.__version__)"])
    : capture("conda", ["run", "-n", runtime.condaEnv, "python", "-c", "import rqdatac;print(rqdatac.__version__)"]);
  if (installed) {
    console.log(`已检测到 rqdatac ${installed}，跳过安装。`);
  } else {
    console.log(`安装 rqsdk==${RQSDK_VERSION}（RQData 的 rqdatac 组件随之安装）…`);
    runInRuntime(runtime, ["-m", "pip", "install", `rqsdk==${RQSDK_VERSION}`]);
  }

  const uri = toRqdatacUri(env.RQSDK_LICENSE_KEY);
  if (!uri) {
    console.log("RQSDK_LICENSE_KEY 仍为空：跳过许可证校验。填写 .env 后重新执行 npm run rqdata:setup。");
    runInRuntime(runtime, ["-c", "import rqdatac;print('rqdatac import ok')"]);
    return;
  }

  console.log("校验许可证并连接 RQData…");
  runInRuntime(
    runtime,
    ["-c", "import rqdatac;rqdatac.init();print('RQData 连接成功：', len(rqdatac.all_instruments(type=\"CS\")), '只 A 股')"],
    { env: { ...process.env, RQDATAC2_CONF: uri } },
  );
  console.log("配置完成。执行 npm run rqdata:start 启动 Bridge。");
}

function commandStart(env) {
  const runtime = resolveRuntime(env, { create: false });
  if (!runtime) throw new Error("未找到 RQData 运行环境。请先执行 npm run rqdata:setup。");

  const bridgeUrl = new URL(env.RICEQUANT_BRIDGE_URL || "http://127.0.0.1:8765");
  const uri = toRqdatacUri(env.RQSDK_LICENSE_KEY);
  if (!uri) throw new Error("RQSDK_LICENSE_KEY 为空。请先在 .env 中填写许可证。");

  runInRuntime(
    runtime,
    [SERVER_FILE, "--host", bridgeUrl.hostname, "--port", bridgeUrl.port || "8765"],
    { env: { ...process.env, RQDATAC2_CONF: uri } },
  );
}

/**
 * Bridge 指标口径测试。用假 rqdatac 模块跑，不需要许可证也不联网，
 * 因此可以在没有 RQData 订阅的机器上验证换算逻辑。
 */
function commandTest(env) {
  const runtime = resolveRuntime(env, { create: false });
  if (!runtime) throw new Error("未找到 RQData 运行环境。请先执行 npm run rqdata:setup。");
  runInRuntime(runtime, ["-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py", "-v"]);
}

// 仅在被直接执行时跑 CLI；被测试 import 时只导出纯函数。
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const command = process.argv[2];
  if (command !== "setup" && command !== "start" && command !== "test") {
    console.error("用法：node scripts/rqdata.mjs setup|start|test");
    process.exit(1);
  }
  try {
    const env = readDotEnv();
    if (command === "setup") commandSetup(env);
    else if (command === "test") commandTest(env);
    else commandStart(env);
  } catch (error) {
    console.error(`\nRQData ${command} 失败：${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
