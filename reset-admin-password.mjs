import {
  randomBytes,
  randomUUID,
  scrypt,
} from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.join(root, "data");
const userDataFile = path.join(dataDirectory, "users.json");
const scryptAsync = promisify(scrypt);

function readHidden(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("请在交互式终端中运行此命令，以安全输入新密码。");
  }

  return new Promise((resolve, reject) => {
    const characters = [];
    const input = process.stdin;
    const finish = (error, value) => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\u0003" || character === "\u0004") {
          finish(new Error("已取消密码重置。"));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish(null, characters.join(""));
          return;
        }
        if (character === "\u007f" || character === "\b") {
          characters.pop();
        } else if (character >= " ") {
          characters.push(character);
        }
      }
    };

    input.setEncoding("utf8");
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
    process.stdout.write(prompt);
  });
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

async function main() {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.some((argument) => argument !== "--generate")) {
    throw new Error("用法：npm run reset-admin-password [-- --generate]");
  }
  const generateRandomPassword = argumentsList.includes("--generate");

  let storedUsers;
  try {
    storedUsers = JSON.parse(await readFile(userDataFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("还没有初始化账号库。请先运行 npm start，并使用首次启动时显示的管理员密码登录。");
    }
    throw new Error(`读取 data/users.json 失败：${error.message}`);
  }
  if (!Array.isArray(storedUsers)) throw new Error("data/users.json 格式无效，未修改任何数据。");

  const administrators = storedUsers.filter((user) => user?.role === "admin");
  const [administrator] = administrators;
  if (administrators.length !== 1
      || typeof administrator.id !== "string"
      || typeof administrator.username !== "string"
      || !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(administrator.passwordHash)) {
    throw new Error("账号库中必须恰好有一位有效管理员；未修改任何数据。");
  }
  if (administrator.trustedDevices !== undefined && !Array.isArray(administrator.trustedDevices)) {
    throw new Error("管理员终端配置格式无效，未修改任何数据。");
  }

  let password;
  if (generateRandomPassword) {
    password = randomBytes(24).toString("base64url");
  } else {
    password = await readHidden("输入新的管理员密码（至少 10 位）：");
    if (password.length < 10 || password.length > 128) {
      throw new Error("密码长度需为 10 到 128 个字符；未修改任何数据。");
    }
    const confirmation = await readHidden("再次输入新密码：");
    if (password !== confirmation) throw new Error("两次输入的密码不一致；未修改任何数据。");
  }

  administrator.passwordHash = await hashPassword(password);
  administrator.trustedDevices = [];
  const temporaryFile = `${userDataFile}.${randomUUID()}.tmp`;
  let temporaryFileCreated = false;
  try {
    await mkdir(dataDirectory, { recursive: true });
    await writeFile(temporaryFile, JSON.stringify(storedUsers, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    temporaryFileCreated = true;
    await rename(temporaryFile, userDataFile);
    temporaryFileCreated = false;
  } catch (error) {
    if (temporaryFileCreated) {
      try {
        await unlink(temporaryFile);
      } catch (cleanupError) {
        if (cleanupError.code !== "ENOENT") {
          throw new Error(`保存密码失败，且无法清理临时文件：${cleanupError.message}`);
        }
      }
    }
    throw new Error(`保存密码失败：${error.message}`);
  }

  console.log(`管理员账号 ${administrator.username} 的密码已重置。`);
  if (generateRandomPassword) console.log(`新随机密码（请立即保存）：${password}`);
  console.log("该管理员账号的已记住终端已撤销；其他家庭账号、偏好和设备数据均已保留。");
  console.log("重新启动家庭助手后，使用新密码登录。");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
