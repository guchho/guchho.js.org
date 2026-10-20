import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'fflate';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSTALL_SH = path.join(ROOT, 'public', 'install');
const INSTALL_PS1 = path.join(ROOT, 'public', 'install.ps1');

// Async spawn: the mock registry runs on THIS process's event loop, so any
// spawnSync while it is listening would deadlock (the child's HTTP requests
// could never be answered).
function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: options.env || process.env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    child.on('error', (err) => resolve({ status: -1, stdout, stderr: String(err) }));
  });
}

const bashAvailable =
  spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' }).stdout?.trim() === 'ok';
const isWindows = process.platform === 'win32';
const systemRoot = process.env.SystemRoot || 'C:\\Windows';
const powershellExe = path.join(
  systemRoot,
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe'
);
const powershellAvailable =
  isWindows && fs.existsSync(powershellExe);
const cscCandidates = [
  path.join(systemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
  path.join(systemRoot, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
];
const cscExe = cscCandidates.find((p) => fs.existsSync(p)) || null;

// ---------------------------------------------------------------------------
// Minimal ustar tar writer + fixtures
// ---------------------------------------------------------------------------

function tarHeader(name, size, mode, typeflag, linkname = '') {
  const buf = Buffer.alloc(512);
  buf.write(name, 0, 100, 'utf8');
  buf.write(mode.toString(8).padStart(7, '0') + '\0', 100, 8);
  buf.write('0000000\0', 108, 8);
  buf.write('0000000\0', 116, 8);
  buf.write(size.toString(8).padStart(11, '0') + '\0', 124, 12);
  buf.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136, 12);
  buf.write('        ', 148, 8);
  buf.write(typeflag, 156, 1);
  buf.write(linkname, 157, 100, 'utf8');
  buf.write('ustar\0', 257, 6);
  buf.write('00', 263, 2);
  let sum = 0;
  for (const b of buf) sum += b;
  buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return buf;
}

function makeTar(entries) {
  const chunks = [];
  for (const entry of entries) {
    const data = entry.data ? Buffer.from(entry.data) : Buffer.alloc(0);
    chunks.push(tarHeader(entry.name, data.length, entry.mode ?? 0o644, entry.type ?? '0', entry.linkname ?? ''));
    if (data.length) {
      chunks.push(data);
      const pad = (512 - (data.length % 512)) % 512;
      if (pad) chunks.push(Buffer.alloc(pad));
    }
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function manifestFor(name, version) {
  return Buffer.from(
    JSON.stringify({
      name,
      version,
      description: 'test fixture',
    })
  );
}

function posixBinary(version) {
  return Buffer.from(`#!/bin/sh\necho "guchho v${version}"\nexit 0\n`);
}

function platformTarball(pkgName, version, { binary = posixBinary(version), extraEntries = [], omitBinary = false } = {}) {
  const entries = [
    { name: 'package/', mode: 0o755, type: '5' },
    { name: 'package/package.json', data: manifestFor(pkgName, version) },
  ];
  if (!omitBinary) {
    entries.push({ name: 'package/bin/', mode: 0o755, type: '5' });
    entries.push({ name: 'package/bin/guchho', data: binary, mode: 0o755 });
  }
  entries.push(...extraEntries);
  return gzipSync(makeTar(entries));
}

function sha512Integrity(buf) {
  return 'sha512-' + createHash('sha512').update(buf).digest('base64');
}
function sha1Hex(buf) {
  return createHash('sha1').update(buf).digest('hex');
}

// ---------------------------------------------------------------------------
// Mock npm registry
// ---------------------------------------------------------------------------

async function startRegistry(spec) {
  // spec: { '@guchho/linux-x64': { latest: '1.0.8', versions: {
  //   '1.0.8': { tgz, integrity?, shasum?, corruptIntegrity? } } } }
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    const urlPath = req.url.replace(/^\//, '');
    // Scoped packages (@scope/name) contain a '/' in the URL path.
    const segments = urlPath.split('/');
    let pkgPath;
    let rest;
    if (urlPath.startsWith('@')) {
      pkgPath = segments.slice(0, 2).join('/');
      rest = segments.slice(2);
    } else {
      pkgPath = segments[0];
      rest = segments.slice(1);
    }

    const pkg = spec[pkgPath];
    const baseName = pkgPath.includes('/') ? pkgPath.split('/')[1] : pkgPath;

    // Tarball: /@scope/name/-/name-version.tgz
    if (rest[0] === '-') {
      const file = rest[1] || '';
      if (!pkg) {
        res.writeHead(404).end('not found');
        return;
      }
      for (const [version, entry] of Object.entries(pkg.versions)) {
        if (file === `${baseName}-${version}.tgz`) {
          res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(entry.tgz);
          return;
        }
      }
      res.writeHead(404).end('not found');
      return;
    }

    if (!pkg) {
      res.writeHead(404).end('not found');
      return;
    }
    let version = rest[0];
    if (!version || version === 'latest') version = pkg.latest;
    const entry = pkg.versions[version];
    if (!entry) {
      res.writeHead(404).end('not found');
      return;
    }
    const integrity =
      entry.corruptIntegrity ?? entry.integrity ?? sha512Integrity(entry.tgz);
    const shasum = entry.shasum ?? sha1Hex(entry.tgz);
    const doc = {
      name: pkgPath,
      version,
      dist: {
        tarball: `http://127.0.0.1:${server.address().port}/${pkgPath}/-/${baseName}-${version}.tgz`,
        integrity,
        shasum,
      },
    };
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(doc));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function withRegistry(spec, fn) {
  const registry = await startRegistry(spec);
  try {
    await fn(registry);
  } finally {
    await registry.close();
  }
}

function makeTempRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `guchho-install-tests-${label}-`));
}

// ---------------------------------------------------------------------------
// Bash installer helpers
// ---------------------------------------------------------------------------

function runBashInstaller(root, { env = {}, args = [] } = {}) {
  const home = path.join(root, 'home');
  const installDir = path.join(root, 'install');
  fs.mkdirSync(home, { recursive: true });
  for (const rc of ['.bashrc', '.zshrc']) {
    const rcPath = path.join(home, rc);
    if (!fs.existsSync(rcPath)) fs.writeFileSync(rcPath, '');
  }
  return runCommand('bash', [INSTALL_SH, ...args], {
    env: {
      ...process.env,
      HOME: home,
      GUCHHO_INSTALL: installDir,
      GUCHHO_TEST_PLATFORM: 'linux-x64',
      NO_COLOR: '1',
      ...env,
    },
  });
}

function specWith(pkgName, versions, latest) {
  return {
    [pkgName]: {
      latest: latest ?? Object.keys(versions).sort().pop(),
      versions,
    },
  };
}

// ---------------------------------------------------------------------------
// Bash installer tests
// ---------------------------------------------------------------------------

test('bash: installs successfully from the latest published version', { skip: !bashAvailable }, async () => {
  const root = makeTempRoot('bash-ok');
  const tgz = platformTarball('@guchho/linux-x64', '1.0.8');
  await withRegistry(specWith('@guchho/linux-x64', { '1.0.8': { tgz } }, '1.0.8'), async (reg) => {
    const result = await runBashInstaller(root, { env: { GUCHHO_REGISTRY: reg.url } });
    assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
    assert.match(result.stdout, /Resolved: @guchho\/linux-x64@1\.0\.8/);
    assert.match(result.stdout, /installed successfully/);

    const bin = path.join(root, 'install', 'bin', 'guchho');
    assert.ok(fs.existsSync(bin), 'installed binary missing');
    const run = spawnSync('bash', [bin, '--version'], { encoding: 'utf8' });
    assert.equal(run.stdout.trim(), 'guchho v1.0.8');

    const bashrc = fs.readFileSync(path.join(root, 'home', '.bashrc'), 'utf8');
    assert.match(bashrc, /export PATH=".*install.*bin:\$PATH"/);
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('bash: pins an explicit version', { skip: !bashAvailable }, async () => {
  const root = makeTempRoot('bash-pin');
  const tgz = platformTarball('@guchho/linux-x64', '1.0.5');
  await withRegistry(specWith('@guchho/linux-x64', {
    '1.0.5': { tgz },
    '1.0.8': { tgz: platformTarball('@guchho/linux-x64', '1.0.8') },
  }, '1.0.8'), async (reg) => {
    const result = await runBashInstaller(root, { env: { GUCHHO_REGISTRY: reg.url, GUCHHO_VERSION: '1.0.5' } });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout, /Resolved: @guchho\/linux-x64@1\.0\.5/);
    const run = spawnSync('bash', [path.join(root, 'install', 'bin', 'guchho'), '--version'], { encoding: 'utf8' });
    assert.equal(run.stdout.trim(), 'guchho v1.0.5');
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('bash: fails clearly when the pinned version is unpublished', { skip: !bashAvailable }, async () => {
  const root = makeTempRoot('bash-404ver');
  const tgz = platformTarball('@guchho/linux-x64', '1.0.8');
  await withRegistry(specWith('@guchho/linux-x64', { '1.0.8': { tgz } }, '1.0.8'), async (reg) => {
    const result = await runBashInstaller(root, { env: { GUCHHO_REGISTRY: reg.url, GUCHHO_VERSION: '9.9.9' } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Version 9\.9\.9 is not published for @guchho\/linux-x64/);
    assert.ok(!fs.existsSync(path.join(root, 'install', 'bin', 'guchho')));
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('bash: fails clearly when the platform package is unpublished', { skip: !bashAvailable }, async () => {
  const root = makeTempRoot('bash-404pkg');
  await withRegistry({}, async (reg) => {
    const result = await runBashInstaller(root, { env: { GUCHHO_REGISTRY: reg.url } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Package @guchho\/linux-x64 is not published/);
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('bash: rejects a SHA-512 integrity mismatch and installs nothing', { skip: !bashAvailable }, async () => {
  const root = makeTempRoot('bash-badhash');
  const tgz = platformTarball('@guchho/linux-x64', '1.0.8');
  await withRegistry(specWith('@guchho/linux-x64', {
    '1.0.8': { tgz, corruptIntegrity: 'sha512-' + 'A'.repeat(88) },
  }, '1.0.8'), async (reg) => {
    const result = await runBashInstaller(root, { env: { GUCHHO_REGISTRY: reg.url } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Integrity check failed/);
    assert.ok(!fs.existsSync(path.join(root, 'install', 'bin', 'guchho')));
    const leftovers = fs.existsSync(path.join(root, 'install'))
      ? fs.readdirSync(path.join(root, 'install')).filter((f) => f.startsWith('.staging'))
      : [];
    assert.deepEqual(leftovers, [], 'staging directories must be cleaned up');
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('bash: verifies SHA-1 shasum when integrity is absent', { skip: !bashAvailable }, async () => {
  const root = makeTempRoot('bash-sha1');
  const tgz = platformTarball('@guchho/linux-x64', '1.0.8');
  await withRegistry(specWith('@guchho/linux-x64', {
    '1.0.8': { tgz, integrity: '' },
  }, '1.0.8'), async (reg) => {
    const result = await runBashInstaller(root, { env: { GUCHHO_REGISTRY: reg.url } });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout, /installed successfully/);
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('bash: rejects a corrupt archive', { skip: !bashAvailable }, async () => {
  const root = makeTempRoot('bash-corrupt');
  const garbage = gzipSync(Buffer.from('this is not a tar archive at all'));
  await withRegistry(specWith('@guchho/linux-x64', { '1.0.8': { tgz: garbage } }, '1.0.8'), async (reg) => {
    const result = await runBashInstaller(root, { env: { GUCHHO_REGISTRY: reg.url } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /corrupt|not a gzip tar/i);
    assert.ok(!fs.existsSync(path.join(root, 'install', 'bin', 'guchho')));
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('bash: rejects path traversal entries', { skip: !bashAvailable }, async () => {
  const root = makeTempRoot('bash-traversal');
  const tgz = platformTarball('@guchho/linux-x64', '1.0.8', {
    extraEntries: [{ name: 'package/../../evil.txt', data: 'pwned' }],
  });
  await withRegistry(specWith('@guchho/linux-x64', { '1.0.8': { tgz } }, '1.0.8'), async (reg) => {
    const result = await runBashInstaller(root, { env: { GUCHHO_REGISTRY: reg.url } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsafe path traversal/);
    assert.ok(!fs.existsSync(path.join(root, 'install', 'bin', 'guchho')));
    assert.ok(!fs.existsSync(path.join(root, 'evil.txt')));
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('bash: rejects symlink entries', { skip: !bashAvailable }, async () => {
  const root = makeTempRoot('bash-symlink');
  const tgz = platformTarball('@guchho/linux-x64', '1.0.8', {
    extraEntries: [{ name: 'package/bin/link', type: '2', linkname: '/etc/passwd' }],
  });
  await withRegistry(specWith('@guchho/linux-x64', { '1.0.8': { tgz } }, '1.0.8'), async (reg) => {
    const result = await runBashInstaller(root, { env: { GUCHHO_REGISTRY: reg.url } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unexpected link entry/);
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('bash: rejects an archive without the expected executable', { skip: !bashAvailable }, async () => {
  const root = makeTempRoot('bash-nobin');
  const tgz = platformTarball('@guchho/linux-x64', '1.0.8', { omitBinary: true });
  await withRegistry(specWith('@guchho/linux-x64', { '1.0.8': { tgz } }, '1.0.8'), async (reg) => {
    const result = await runBashInstaller(root, { env: { GUCHHO_REGISTRY: reg.url } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unexpected package layout/);
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('bash: PATH entries are not duplicated across runs', { skip: !bashAvailable }, async () => {
  const root = makeTempRoot('bash-dedupe');
  const tgz = platformTarball('@guchho/linux-x64', '1.0.8');
  await withRegistry(specWith('@guchho/linux-x64', { '1.0.8': { tgz } }, '1.0.8'), async (reg) => {
    const first = await runBashInstaller(root, { env: { GUCHHO_REGISTRY: reg.url } });
    assert.equal(first.status, 0, first.stderr);
    const second = await runBashInstaller(root, { env: { GUCHHO_REGISTRY: reg.url } });
    assert.equal(second.status, 0, second.stderr);
    const bashrc = fs.readFileSync(path.join(root, 'home', '.bashrc'), 'utf8');
    const installDir = path.join(root, 'install');
    const occurrences = bashrc.split(installDir).length - 1;
    assert.equal(occurrences, 1, `expected one PATH entry, found ${occurrences}`);
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('bash: GUCHHO_NO_PATH_UPDATE skips profile changes and prints manual steps', { skip: !bashAvailable }, async () => {
  const root = makeTempRoot('bash-nopath');
  const tgz = platformTarball('@guchho/linux-x64', '1.0.8');
  await withRegistry(specWith('@guchho/linux-x64', { '1.0.8': { tgz } }, '1.0.8'), async (reg) => {
    const result = await runBashInstaller(root, {
      env: { GUCHHO_REGISTRY: reg.url, GUCHHO_NO_PATH_UPDATE: '1' },
    });
    assert.equal(result.status, 0, result.stderr);
    const bashrc = fs.readFileSync(path.join(root, 'home', '.bashrc'), 'utf8');
    assert.equal(bashrc.includes('install'), false);
    assert.match(result.stdout, /Add this line to your shell profile/);
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('bash: replaces an existing installation', { skip: !bashAvailable }, async () => {
  const root = makeTempRoot('bash-upgrade');
  const oldTgz = platformTarball('@guchho/linux-x64', '1.0.7');
  const newTgz = platformTarball('@guchho/linux-x64', '1.0.8');
  await withRegistry(specWith('@guchho/linux-x64', {
    '1.0.7': { tgz: oldTgz },
    '1.0.8': { tgz: newTgz },
  }, '1.0.8'), async (reg) => {
    const first = await runBashInstaller(root, { env: { GUCHHO_REGISTRY: reg.url, GUCHHO_VERSION: '1.0.7' } });
    assert.equal(first.status, 0, first.stderr);
    const second = await runBashInstaller(root, { env: { GUCHHO_REGISTRY: reg.url } });
    assert.equal(second.status, 0, second.stderr);
    const run = spawnSync('bash', [path.join(root, 'install', 'bin', 'guchho'), '--version'], { encoding: 'utf8' });
    assert.equal(run.stdout.trim(), 'guchho v1.0.8');
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('bash: selects the darwin-arm64 package for that platform', { skip: !bashAvailable }, async () => {
  const root = makeTempRoot('bash-darwin');
  const tgz = platformTarball('@guchho/darwin-arm64', '1.0.8');
  await withRegistry(specWith('@guchho/darwin-arm64', { '1.0.8': { tgz } }, '1.0.8'), async (reg) => {
    const result = await runBashInstaller(root, {
      env: { GUCHHO_REGISTRY: reg.url, GUCHHO_TEST_PLATFORM: 'darwin-arm64' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Platform package: @guchho\/darwin-arm64/);
    assert.ok(reg.requests.includes('/@guchho/darwin-arm64/latest'));
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('bash: rejects unsupported platforms', { skip: !bashAvailable }, async () => {
  const root = makeTempRoot('bash-badplat');
  await withRegistry({}, async (reg) => {
    for (const platform of ['win32-x64', 'linux-arm64', 'darwin-x64', 'freebsd-x64']) {
      const result = await runBashInstaller(root, {
        env: { GUCHHO_REGISTRY: reg.url, GUCHHO_TEST_PLATFORM: platform },
      });
      assert.notEqual(result.status, 0, platform);
      assert.match(result.stderr, /Unsupported platform|not a verified target/, platform);
    }
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('bash: rejects version strings with path characters', { skip: !bashAvailable }, async () => {
  const root = makeTempRoot('bash-badver');
  await withRegistry({}, async (reg) => {
    const result = await runBashInstaller(root, {
      env: { GUCHHO_REGISTRY: reg.url, GUCHHO_VERSION: '../../etc/passwd' },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid version string/);
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('bash: refuses a non-HTTPS registry', { skip: !bashAvailable }, async () => {
  const root = makeTempRoot('bash-nohttps');
  const result = await runBashInstaller(root, { env: { GUCHHO_REGISTRY: 'http://registry.example.com' } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing non-HTTPS registry/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('bash: --help prints usage and exits 0', { skip: !bashAvailable }, () => {
  const result = spawnSync('bash', [INSTALL_SH, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
});

test('bash: sourced helpers parse registry fields and versions safely', { skip: !bashAvailable }, () => {
  const script = `
    GUCHHO_SOURCED=1
    source "${INSTALL_SH}"
    json_str_field '{"name":"@guchho/linux-x64","version":"1.0.8","dist":{"tarball":"https://registry.npmjs.org/@guchho/linux-x64/-/linux-x64-1.0.8.tgz"}}' tarball
  `;
  const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'https://registry.npmjs.org/@guchho/linux-x64/-/linux-x64-1.0.8.tgz');
});

// ---------------------------------------------------------------------------
// PowerShell installer helpers
// ---------------------------------------------------------------------------

function compileStubExe(dir, version) {
  if (!cscExe) return null;
  const csPath = path.join(dir, 'stub.cs');
  const exePath = path.join(dir, 'stub.exe');
  fs.writeFileSync(
    csPath,
    `using System;\nclass GuchhoStub {\n  static void Main(string[] args) {\n    Console.WriteLine("guchho v${version}");\n  }\n}\n`
  );
  const result = spawnSync(cscExe, ['/nologo', '/target:exe', `/out:${exePath}`, csPath], {
    encoding: 'utf8',
  });
  if (result.status !== 0 || !fs.existsSync(exePath)) return null;
  return fs.readFileSync(exePath);
}

function runPsInstaller({ env = {}, args = [] } = {}) {
  const scriptArgs = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    INSTALL_PS1,
    ...args,
  ];
  return runCommand(powershellExe, scriptArgs, {
    env: { ...process.env, NO_COLOR: '1', ...env },
  });
}

function windowsTarball(pkgName, version, exeBytes) {
  const entries = [
    { name: 'package/', mode: 0o755, type: '5' },
    { name: 'package/package.json', data: manifestFor(pkgName, version) },
    { name: 'package/bin/', mode: 0o755, type: '5' },
    { name: 'package/bin/guchho.exe', data: exeBytes, mode: 0o755 },
  ];
  return gzipSync(makeTar(entries));
}

// ---------------------------------------------------------------------------
// PowerShell installer tests
// ---------------------------------------------------------------------------

test('powershell: architecture detection reports the real OS architecture', { skip: !powershellAvailable }, () => {
  const cmd = `. "${INSTALL_PS1}"; $arch = Get-SystemArchitecture; Write-Output $arch; if ($arch -ne 'x64' -and $arch -ne 'arm64') { exit 1 }`;
  const result = spawnSync(powershellExe, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /^(x64|arm64)$/);
});

test('powershell: integrity verification accepts good hashes and rejects bad ones', { skip: !powershellAvailable }, () => {
  const root = makeTempRoot('ps-integrity');
  const file = path.join(root, 'blob.bin');
  const data = Buffer.from('integrity test payload');
  fs.writeFileSync(file, data);
  const good = 'sha512-' + createHash('sha512').update(data).digest('base64');
  const bad = 'sha512-' + createHash('sha512').update('other').digest('base64');

  const ok = spawnSync(
    powershellExe,
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `. "${INSTALL_PS1}"; Test-ArchiveIntegrity '${file}' '${good}' ''; Write-Output 'ok'`,
    ],
    { encoding: 'utf8' }
  );
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /ok/);

  const fail = spawnSync(
    powershellExe,
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `. "${INSTALL_PS1}"; Test-ArchiveIntegrity '${file}' '${bad}' ''`,
    ],
    { encoding: 'utf8' }
  );
  assert.notEqual(fail.status, 0);
  assert.match(fail.stdout + fail.stderr, /Integrity check failed/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('powershell: installs successfully from the latest published version', { skip: !powershellAvailable || !cscExe }, async () => {
  const root = makeTempRoot('ps-ok');
  const exe = compileStubExe(root, '1.0.8');
  assert.ok(exe, 'csc stub compilation failed');
  const tgz = windowsTarball('@guchho/win32-x64', '1.0.8', exe);
  const installDir = path.join(root, 'guchho-home');
  await withRegistry(specWith('@guchho/win32-x64', { '1.0.8': { tgz } }, '1.0.8'), async (reg) => {
    const result = await runPsInstaller({
      env: { GUCHHO_REGISTRY: reg.url },
      args: ['-InstallDir', installDir, '-NoPathUpdate'],
    });
    assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
    assert.match(result.stdout, /Resolved: @guchho\/win32-x64@1\.0\.8/);
    assert.match(result.stdout, /installed successfully/);
    const bin = path.join(installDir, 'bin', 'guchho.exe');
    assert.ok(fs.existsSync(bin), 'installed binary missing');
    const run = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    assert.match(run.stdout, /guchho v1\.0\.8/);
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('powershell: skips reinstall of the same version unless -Force is given', { skip: !powershellAvailable || !cscExe }, async () => {
  const root = makeTempRoot('ps-skip');
  const exe = compileStubExe(root, '1.0.8');
  const tgz = windowsTarball('@guchho/win32-x64', '1.0.8', exe);
  const installDir = path.join(root, 'guchho-home');
  await withRegistry(specWith('@guchho/win32-x64', { '1.0.8': { tgz } }, '1.0.8'), async (reg) => {
    const first = await runPsInstaller({
      env: { GUCHHO_REGISTRY: reg.url },
      args: ['-InstallDir', installDir, '-NoPathUpdate'],
    });
    assert.equal(first.status, 0, first.stderr);

    const second = await runPsInstaller({
      env: { GUCHHO_REGISTRY: reg.url },
      args: ['-InstallDir', installDir, '-NoPathUpdate'],
    });
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /already installed/);

    const forced = await runPsInstaller({
      env: { GUCHHO_REGISTRY: reg.url },
      args: ['-InstallDir', installDir, '-NoPathUpdate', '-Force'],
    });
    assert.equal(forced.status, 0, forced.stderr);
    assert.match(forced.stdout, /installed successfully/);
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('powershell: fails clearly when the pinned version is unpublished', { skip: !powershellAvailable || !cscExe }, async () => {
  const root = makeTempRoot('ps-404');
  const exe = compileStubExe(root, '1.0.8');
  const tgz = windowsTarball('@guchho/win32-x64', '1.0.8', exe);
  const installDir = path.join(root, 'guchho-home');
  await withRegistry(specWith('@guchho/win32-x64', { '1.0.8': { tgz } }, '1.0.8'), async (reg) => {
    const result = await runPsInstaller({
      env: { GUCHHO_REGISTRY: reg.url },
      args: ['-Version', '9.9.9', '-InstallDir', installDir, '-NoPathUpdate'],
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /Version 9\.9\.9 is not published for @guchho\/win32-x64/);
    assert.ok(!fs.existsSync(path.join(installDir, 'bin', 'guchho.exe')));
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('powershell: rejects a SHA-512 integrity mismatch and installs nothing', { skip: !powershellAvailable || !cscExe }, async () => {
  const root = makeTempRoot('ps-badhash');
  const exe = compileStubExe(root, '1.0.8');
  const tgz = windowsTarball('@guchho/win32-x64', '1.0.8', exe);
  const installDir = path.join(root, 'guchho-home');
  await withRegistry(specWith('@guchho/win32-x64', {
    '1.0.8': { tgz, corruptIntegrity: 'sha512-' + 'A'.repeat(88) },
  }, '1.0.8'), async (reg) => {
    const result = await runPsInstaller({
      env: { GUCHHO_REGISTRY: reg.url },
      args: ['-InstallDir', installDir, '-NoPathUpdate'],
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /Integrity check failed/);
    assert.ok(!fs.existsSync(path.join(installDir, 'bin', 'guchho.exe')));
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('powershell: rejects path traversal entries', { skip: !powershellAvailable || !cscExe }, async () => {
  const root = makeTempRoot('ps-traversal');
  const exe = compileStubExe(root, '1.0.8');
  const evilTgz = gzipSync(
    makeTar([
      { name: 'package/', mode: 0o755, type: '5' },
      { name: 'package/package.json', data: manifestFor('@guchho/win32-x64', '1.0.8') },
      { name: 'package/bin/', mode: 0o755, type: '5' },
      { name: 'package/bin/guchho.exe', data: exe, mode: 0o755 },
      { name: 'package/../../evil.txt', data: 'pwned' },
    ])
  );
  const installDir = path.join(root, 'guchho-home');
  await withRegistry(specWith('@guchho/win32-x64', { '1.0.8': { tgz: evilTgz } }, '1.0.8'), async (reg) => {
    const result = await runPsInstaller({
      env: { GUCHHO_REGISTRY: reg.url },
      args: ['-InstallDir', installDir, '-NoPathUpdate'],
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /Unsafe path traversal/);
    assert.ok(!fs.existsSync(path.join(installDir, 'bin', 'guchho.exe')));
    assert.ok(!fs.existsSync(path.join(root, 'evil.txt')));
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('powershell: -Help prints usage and exits 0', { skip: !powershellAvailable }, async () => {
  const result = await runPsInstaller({ args: ['-Help'] });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
});

test('powershell: refuses a non-HTTPS registry', { skip: !powershellAvailable }, async () => {
  const result = await runPsInstaller({
    env: { GUCHHO_REGISTRY: 'http://registry.example.com' },
    args: ['-InstallDir', path.join(os.tmpdir(), 'guchho-ps-nohttps'), '-NoPathUpdate'],
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /Refusing non-HTTPS registry/);
});
