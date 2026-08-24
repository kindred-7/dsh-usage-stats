#!/usr/bin/env node
// ============================================================================
// dsh-usage-stats 注册脚本（零依赖）
//
// 在 dsh web profile 目录下执行（脚本只改「当前目录」的 package.json）：
//
//   cd %USERPROFILE%\.dsh\profiles\web
//   pnpm add <本包 .tgz 的路径>                        # 安装 + 写 dependencies
//   pnpm exec dsh-usage-register       # 写入 dsh.profile.bundles
//   pnpm exec dsh-usage-register --remove   # 反注册 bundles
//
// 参数：
//   --profile-dir <路径>   显式指定 profile 目录（优先于当前目录）
//   --remove               从 bundles 移除条目（依赖声明请用 pnpm remove）
//
// 安全策略：默认只修改【当前工作目录】下的 package.json；
// 仅当当前目录没有 package.json 时才回退到 ~\.dsh\profiles\web。
// 每次写入前都会打印目标文件路径。
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const pluginName = "dsh-usage-stats";

// --- 解析命令行参数 -----------------------------------------------------------
const argv = process.argv.slice(2);
const remove = argv.includes("--remove");
let profileDir;
const idx = argv.indexOf("--profile-dir");
if (idx !== -1 && argv[idx + 1]) {
  // 1) 显式指定，最优先
  profileDir = path.resolve(argv[idx + 1]);
} else if (fs.existsSync(path.join(process.cwd(), "package.json"))) {
  // 2) 当前目录有 package.json → 就改它（推荐用法：cd 进 profile 再执行）
  profileDir = process.cwd();
} else {
  // 3) 回退：默认 profile 目录
  profileDir = path.join(os.homedir(), ".dsh", "profiles", "web");
  console.warn(`[register] 当前目录无 package.json，回退到默认 profile: ${profileDir}`);
}

const pkgPath = path.join(profileDir, "package.json");
console.log(`[register] 目标文件: ${pkgPath}`);

// --- 前置检查 -----------------------------------------------------------------
if (!fs.existsSync(pkgPath)) {
  console.error(`[register] 未找到 ${pkgPath}`);
  console.error("[register] 请先 cd 到 dsh web profile 目录，或先运行一次 'dsh web' 初始化");
  process.exit(1);
}

// --- 读改写 package.json（UTF-8 无 BOM）----------------------------------------
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

pkg.dsh ??= {};
pkg.dsh.profile ??= {};
const before = pkg.dsh.profile.bundles ?? [];
const bundles = new Set(before);

let changed = false;
if (remove) {
  if (bundles.delete(pluginName)) changed = true;
} else {
  if (!bundles.has(pluginName)) {
    bundles.add(pluginName);
    changed = true;
  }
}

if (!changed) {
  console.log("[register] bundles 无变化，跳过");
  process.exit(0);
}

pkg.dsh.profile.bundles = [...bundles];
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");

console.log(
  remove
    ? `[register] 已从 dsh.profile.bundles 移除 ${pluginName}`
    : `[register] 已将 ${pluginName} 加入 dsh.profile.bundles`
);
console.log("[register] 重启 DSH 生效:  dsh web");

