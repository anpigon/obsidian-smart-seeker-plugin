import { readFileSync, writeFileSync } from "fs";

// 버전 타입 확인 (major, minor, patch)
const versionType = process.argv[2] || "patch";
if (!["major", "minor", "patch"].includes(versionType)) {
  console.error('Invalid version type. Use "major", "minor", or "patch"');
  process.exit(1);
}

// package.json에서 현재 버전을 읽고 버전을 증가시킵니다.
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const [major, minor, patch] = packageJson.version.split(".").map(Number);

let newVersion;
switch (versionType) {
  case "major":
    newVersion = `${major + 1}.0.0`;
    break;
  case "minor":
    newVersion = `${major}.${minor + 1}.0`;
    break;
  case "patch":
    newVersion = `${major}.${minor}.${patch + 1}`;
    break;
}

packageJson.version = newVersion;
writeFileSync("package.json", JSON.stringify(packageJson, null, "\t"));

// manifest.json 업데이트
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = newVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"));

// versions.json 업데이트
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[newVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t"));

console.log(`Version bumped to ${newVersion}`);
