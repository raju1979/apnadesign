import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const crate = resolve(root, "wasm/geometry");
const output = resolve(root, "public/wasm");
const manifestPath = resolve(root, "lib/wasm/manifest.json");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function sourceHash() {
  const digest = createHash("sha256");
  for (const path of ["Cargo.toml", "Cargo.lock", "src/lib.rs"]) {
    digest.update(path);
    digest.update(await readFile(resolve(crate, path)));
  }
  return digest.digest("hex");
}

if (process.argv.includes("--check")) {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const bytes = await readFile(resolve(root, `public${manifest.url}`));
    if (
      manifest.sourceHash !== (await sourceHash()) ||
      manifest.sha256 !== hash(bytes)
    )
      throw new Error("Rust source or WASM binary changed.");
    console.log(`WASM artifact verified (${bytes.length} bytes).`);
  } catch (error) {
    console.error(
      `${error.message} Run npm run wasm:build to regenerate the module.`,
    );
    process.exitCode = 1;
  }
} else {
  const build = spawnSync(
    "cargo",
    [
      "build",
      "--manifest-path",
      resolve(crate, "Cargo.toml"),
      "--target",
      "wasm32-unknown-unknown",
      "--release",
    ],
    { cwd: root, stdio: "inherit" },
  );
  if (build.status !== 0) {
    console.error(
      build.error?.message ||
        "Rust build failed. Install Rust and rustup target add wasm32-unknown-unknown.",
    );
    process.exit(build.status || 1);
  }
  const bytes = await readFile(
    resolve(
      crate,
      "target/wasm32-unknown-unknown/release/formwork_geometry.wasm",
    ),
  );
  const sha256 = hash(bytes);
  const filename = `geometry.${sha256.slice(0, 16)}.wasm`;
  await mkdir(output, { recursive: true });
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(resolve(output, filename), bytes);
  await writeFile(
    manifestPath,
    JSON.stringify(
      { url: `/wasm/${filename}`, sha256, sourceHash: await sourceHash() },
      null,
      2,
    ) + "\n",
  );
  for (const old of await readdir(output)) {
    if (/^geometry\.[a-f0-9]+\.wasm$/.test(old) && old !== filename)
      await rm(resolve(output, old));
  }
  console.log(`Built ${filename} (${bytes.length} bytes).`);
}
