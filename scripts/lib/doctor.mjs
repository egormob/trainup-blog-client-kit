import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function commandExists(name) {
  try {
    await execFileAsync(name, ["--version"], { windowsHide: true });
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    return typeof error?.code === "number";
  }
}

function major(version) {
  const match = String(version).match(/^(?:v)?(\d+)/);
  return match ? Number(match[1]) : 0;
}

export async function doctor(options = {}) {
  const platform = options.platform ?? process.platform;
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const which = options.which ?? commandExists;
  const supported = platform === "darwin" || platform === "win32";
  const checks = [
    {
      id: "system",
      ok: supported,
      label: supported ? "Система поддерживается" : "Нужен компьютер с macOS или Windows",
    },
    {
      id: "node",
      ok: major(nodeVersion) >= 20 && await which("node"),
      label: `Node.js ${nodeVersion}`,
    },
    {
      id: "history",
      ok: await which("git"),
      label: "История версий на компьютере",
    },
    {
      id: "yandex",
      ok: await which("yc"),
      label: "Yandex Cloud CLI",
    },
  ];

  const firstFailure = checks.find((check) => !check.ok);
  const actions = {
    system: "Продолжите на компьютере с macOS или Windows — другие системы эта версия кита не поддерживает.",
    node: "Установите Node.js версии 20 или новее, затем снова запустите проверку.",
    history: "Установите Git: он нужен только для незаметной истории версий и возврата к прошлому состоянию.",
    yandex: "Установите Yandex Cloud CLI, затем снова запустите проверку.",
  };

  return {
    ok: !firstFailure,
    checks,
    nextAction: firstFailure ? actions[firstFailure.id] : "Всё готово — можно создать папку блога.",
  };
}
