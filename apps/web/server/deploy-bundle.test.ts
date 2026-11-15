// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase H Steps 5 and 6: the deploy bundle (deploy/hostinger), the Dockerfile and the workflows.
 * 1. A secret scan over every one of those files (the env templates are allowlisted as
 *    templates: they may NAME a secret, never hold a value).
 * 2. The compose hardening the runtime contract promises (SELF-HOST.md).
 * 3. deploy.sh and rollback.sh refuse anything but a digest of our repository.
 */
const ROOT = join(import.meta.dirname, "..", "..", "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const tracked = (...globs: string[]) =>
  execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...globs],
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);

const SCANNED = tracked(
  "deploy/**",
  ".github/workflows/**",
  ".github/dependabot.yml",
  ".dockerignore",
);
/** Templates: secret NAMES with empty values only. */
const TEMPLATES = new Set([
  "deploy/hostinger/aroma.env.example",
  "deploy/hostinger/migrate.env.example",
]);
const SECRET_NAME =
  /(SECRET|TOKEN|PASSWORD|PRIVATE|KEYPAIR|API_KEYS?|SIGNING_KEY|AUTH_UUID|INVITE|DATABASE_URL)/;

/** Generated at run time so no key-shaped literal is committed by this test either. */
const LEAKS: [string, RegExp][] = [
  ["PEM private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["64-byte key array", /\[\s*(?:\d{1,3}\s*,\s*){63}\d{1,3}\s*\]/],
  ["base58 secret key", /\b[1-9A-HJ-NP-Za-km-z]{86,88}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["Cloudflare tunnel token", /\beyJh[A-Za-z0-9_-]{60,}/],
  ["Postgres URL with password", /postgres(?:ql)?:\/\/[^:\s/]+:[^@\s$]+@/],
  ["bearer token", /Bearer\s+[A-Za-z0-9._~+/-]{20,}/],
];

describe("secret scan: Dockerfile, deploy/**, workflows", () => {
  it("covers the files it must", () => {
    for (const f of [
      "deploy/Dockerfile",
      "deploy/hostinger/docker-compose.yml",
      "deploy/hostinger/deploy.sh",
      "deploy/hostinger/rollback.sh",
      "deploy/hostinger/aroma.env.example",
      ".github/workflows/image.yml",
      ".github/dependabot.yml",
    ])
      expect(SCANNED, f).toContain(f);
  });

  it.each(SCANNED)("%s holds no key material or credential", (file) => {
    const text = read(file);
    for (const [name, pattern] of LEAKS)
      expect(pattern.test(text), `${file}: ${name}`).toBe(false);
  });

  it.each([...TEMPLATES])(
    "%s names secrets but holds no value for any of them",
    (file) => {
      const assignments = read(file)
        .split("\n")
        .map((l) => /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(l.trim()))
        .filter((m): m is RegExpExecArray => Boolean(m));
      expect(assignments.length).toBeGreaterThan(0);
      for (const [, name, value] of assignments)
        if (SECRET_NAME.test(name!)) expect(value, name).toBe("");
    },
  );

  it("no build argument or ENV in the Dockerfile carries a secret", () => {
    const lines = read("deploy/Dockerfile")
      .split("\n")
      .filter((l) => /^\s*(ARG|ENV)\b/.test(l) || /^\s+[A-Z_]+=/.test(l));
    for (const line of lines) {
      const names = line.match(/[A-Z][A-Z0-9_]{2,}(?==)/g) ?? [];
      for (const n of names)
        if (SECRET_NAME.test(n))
          expect(n, `Dockerfile: ${line.trim()}`).toMatch(/^NEXT_PUBLIC_/);
    }
  });
});

describe("docker-compose.yml hardening (SELF-HOST.md)", () => {
  const compose = read("deploy/hostinger/docker-compose.yml");
  const app = compose.slice(
    compose.indexOf("\n  app:"),
    compose.indexOf("\n  cloudflared:"),
  );
  const tunnel = compose.slice(
    compose.indexOf("\n  cloudflared:"),
    compose.indexOf("\nnetworks:"),
  );

  it("the app runs a digest set by deploy.sh, never a tag", () => {
    expect(app).toMatch(/image: \$\{AROMA_IMAGE:\?/);
    expect(compose).not.toMatch(/:latest\b/);
    expect(tunnel).toMatch(
      /image: cloudflare\/cloudflared:[\d.]+@sha256:[0-9a-f]{64}/,
    );
  });

  it("publishes nothing on the host", () => {
    expect(compose).not.toMatch(/^\s*ports:/m);
    expect(compose).not.toMatch(/network_mode:\s*host/);
  });

  it.each([
    ["app", app],
    ["cloudflared", tunnel],
  ])(
    "%s: read-only, no capabilities, no new privileges, limits, rotation",
    (_n, s) => {
      expect(s).toMatch(/read_only: true/);
      expect(s).toMatch(/cap_drop: \[ALL\]/);
      expect(s).toMatch(/no-new-privileges:true/);
      expect(s).toMatch(/pids_limit: \d+/);
      expect(s).toMatch(/mem_limit: \d+[mg]/);
      expect(s).toMatch(/cpus: [\d.]+/);
      expect(s).toMatch(/restart: unless-stopped/);
      expect(s).toMatch(/driver: json-file/);
      expect(s).toMatch(/max-size: "\d+m"/);
      expect(s).toMatch(/user: "\d+:\d+"/);
    },
  );

  it("app: tmpfs /tmp and the cache volume are the only writable paths; healthcheck; drain fits", () => {
    expect(app).toMatch(/\/tmp:rw,noexec,nosuid,nodev,size=\d+m/);
    expect(app).toMatch(/next-cache:\/app\/apps\/web\/\.next\/cache/);
    expect(app).toMatch(/healthcheck\.mjs/);
    expect(app).toMatch(/path: \/etc\/aroma\/aroma\.env/);
    const grace = Number(/stop_grace_period: (\d+)s/.exec(app)?.[1]);
    const drain = Number(
      /drainMs \?\? (\d[\d_]*)/
        .exec(read("deploy/graceful.mjs"))?.[1]
        ?.replace(/_/g, ""),
    );
    expect(drain).toBe(65_000);
    expect(grace * 1000).toBeGreaterThan(drain);
  });

  it("cloudflared reads the tunnel token from a file, never from the compose file or env", () => {
    expect(tunnel).toMatch(/--token-file/);
    expect(tunnel).toMatch(
      /\/etc\/aroma\/tunnel-token:\/run\/secrets\/tunnel-token:ro/,
    );
    expect(compose).not.toMatch(/TUNNEL_TOKEN\s*[:=]/);
    expect(tunnel).toMatch(/condition: service_healthy/);
  });

  it("app and cloudflared share only an internal network", () => {
    expect(compose).toMatch(/edge:\n\s+internal: true/);
  });
});

describe("deploy.sh and rollback.sh refuse anything but our digest", () => {
  const DIGEST = "a".repeat(64);
  const run = (script: string, ...args: string[]) =>
    spawnSync("bash", [join(ROOT, "deploy/hostinger", script), ...args], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" },
    });

  it.each([
    [[]],
    [["ghcr.io/aromalabs/aroma-web:latest"]],
    [["ghcr.io/aromalabs/aroma-web:v1.0.0"]],
    [[`ghcr.io/someone/aroma-web@sha256:${DIGEST}`]],
    [[`ghcr.io/aromalabs/aroma-web@sha256:${"A".repeat(64)}`]],
    [[`ghcr.io/aromalabs/aroma-web@sha256:${DIGEST.slice(1)}`]],
    [[`sha256:${DIGEST}; rm -rf /`]],
    [["a", "b"]],
  ])("deploy.sh %j → exit 2 before touching anything", (args) => {
    const result = run("deploy.sh", ...args);
    expect(result.status).toBe(2);
  });

  it("a valid digest still needs root (exit 2 as a normal user)", () => {
    if (process.getuid?.() === 0) return;
    const result = run("deploy.sh", `sha256:${DIGEST}`);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/sudo/);
  });

  it("rollback.sh refuses a tag or another repository", () => {
    expect(
      run("rollback.sh", "ghcr.io/aromalabs/aroma-web:latest").status,
    ).toBe(2);
    expect(run("rollback.sh", `docker.io/x/y@sha256:${DIGEST}`).status).toBe(2);
  });

  it("both verify the cosign signature against this repository's image workflow", () => {
    for (const script of ["deploy.sh", "rollback.sh"]) {
      const text = read(`deploy/hostinger/${script}`);
      expect(text).toMatch(/cosign verify/);
      expect(text).toContain(
        "aromalabs/aroma/\\.github/workflows/image\\.yml@refs/",
      );
      expect(text).toContain("https://token.actions.githubusercontent.com");
    }
  });

  it("shellcheck is clean (when installed)", () => {
    const probe = spawnSync("shellcheck", ["--version"]);
    if (probe.status !== 0) return;
    const result = spawnSync("shellcheck", [
      "-S",
      "style",
      join(ROOT, "deploy/hostinger/deploy.sh"),
      join(ROOT, "deploy/hostinger/rollback.sh"),
      join(ROOT, "deploy/hostinger/host-check.sh"),
      join(ROOT, "deploy/build-app.sh"),
    ]);
    expect(result.stdout.toString()).toBe("");
    expect(result.status).toBe(0);
  });
});

describe(".github/workflows/image.yml (Step 6; written, not run here)", () => {
  // Comments excluded: they explain, e.g., why there is no SSH step.
  const wf = read(".github/workflows/image.yml")
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

  it("pins every action by a full commit SHA", () => {
    const uses = [...wf.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]!);
    expect(uses.length).toBeGreaterThan(5);
    for (const u of uses)
      expect(u, u).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });

  it("starts from no permissions and grants each job only what it needs", () => {
    expect(wf).toMatch(/^permissions: \{\}$/m);
    expect(wf).toMatch(/id-token: write/);
    expect(wf).not.toMatch(
      /contents: write|actions: write|pull-requests: write/,
    );
  });

  it("uses no secret but the job's own token, and NEXT_PUBLIC_* only from variables", () => {
    const secrets = [...wf.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
    expect([...new Set(secrets)]).toEqual(["GITHUB_TOKEN"]);
    for (const m of wf.matchAll(/NEXT_PUBLIC_[A-Z_]+=\$\{\{\s*([^}]+)\}\}/g))
      expect(m[1]!.trim()).toMatch(/^vars\.NEXT_PUBLIC_/);
  });

  it("scans (Critical/High with a fix), signs keylessly, attests, and never deploys", () => {
    expect(wf).toMatch(/severity: CRITICAL,HIGH/);
    expect(wf).toMatch(/ignore-unfixed: true/);
    expect(wf).toMatch(/exit-code: "1"/);
    expect(wf).toMatch(/cosign sign --yes "\$\{IMAGE\}@\$\{DIGEST\}"/);
    expect(wf).toMatch(/attest-build-provenance/);
    expect(wf).toMatch(/attest-sbom/);
    expect(wf).not.toMatch(
      /\bssh\b|scp |appleboy|deploy\.sh .*\$\{\{ secrets/i,
    );
    expect(wf).not.toMatch(/:latest\b/);
  });

  it("triggers only on main and v* tags (the identities deploy.sh accepts)", () => {
    expect(wf).toMatch(/branches: \[main\]/);
    expect(wf).toMatch(/tags: \["v\*"\]/);
    expect(wf).not.toMatch(/pull_request|workflow_dispatch/);
  });
});

describe("deploy/Dockerfile targets (Step 8)", () => {
  const dockerfile = read("deploy/Dockerfile");
  const stages = [...dockerfile.matchAll(/^FROM \S+ AS (\S+)$/gm)].map(
    (m) => m[1],
  );

  it("the deployable `runtime` is the last stage (the default target) and what CI builds", () => {
    expect(stages.at(-1)).toBe("runtime");
    expect(read(".github/workflows/image.yml")).toMatch(/target: runtime/);
  });

  it("every FROM uses the same digest-pinned official node image", () => {
    const bases = [...dockerfile.matchAll(/^FROM (node:\S+)/gm)].map(
      (m) => m[1],
    );
    expect(bases.length).toBeGreaterThanOrEqual(2);
    for (const b of bases)
      expect(b).toMatch(/^node:24\.12\.0-slim@sha256:[0-9a-f]{64}$/);
  });

  it("the fork-E2E variant is marked and refused under production rules", () => {
    const e2e = dockerfile.slice(
      dockerfile.indexOf("AS runtime-e2e"),
      dockerfile.lastIndexOf("AS runtime\n"),
    );
    expect(e2e).toMatch(/NEXT_PUBLIC_AROMA_E2E_WALLET=true/);
    expect(e2e).toMatch(/org\.aroma\.e2e="true"/);
    expect(read("deploy/build-app.sh")).toMatch(/E2E_BUILD/);
    expect(read("deploy/server.mjs")).toMatch(
      /E2E_BUILD[\s\S]*process\.exit\(1\)/,
    );
    const runtime = dockerfile.slice(dockerfile.lastIndexOf("AS runtime\n"));
    expect(runtime).not.toMatch(/build-e2e|E2E_WALLET=true/);
  });

  it("the runtime gets the bundle's NEXT_PUBLIC_* values from the image, before Next starts", () => {
    expect(read("deploy/build-app.sh")).toMatch(
      /publicEnvOf[\s\S]*> \/out\/deploy\/public-env\.json/,
    );
    const server = read("deploy/server.mjs");
    expect(server).toMatch(/public-env\.json/);
    expect(server.indexOf("applyPublicEnv(")).toBeLessThan(
      server.indexOf('("../apps/web/server.js")'),
    );
    expect(read(".dockerignore")).toMatch(/^!deploy\/public-env\.mjs$/m);
  });

  it("deploy.sh never uses the local override", () => {
    expect(read("deploy/hostinger/deploy.sh")).not.toMatch(/compose\.local/);
    expect(read("deploy/hostinger/rollback.sh")).not.toMatch(/compose\.local/);
  });
});
