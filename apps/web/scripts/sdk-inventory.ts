/* eslint-disable no-console -- CLI report: stdout is the output */
/**
 * M2 baseline: what lib/sdk imports, where `any` leaks into exported types, and how big files are.
 * Run: pnpm --filter @ovelo/web exec tsx scripts/sdk-inventory.ts [--json]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const SDK = join(ROOT, "lib/sdk");
const SCAN = ["lib", "app", "components", "server"].map((d) => join(ROOT, d));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

const sdkFiles = walk(SDK);
const allFiles = SCAN.flatMap((d) => walk(d));

// 1. External package usage (static, dynamic and require forms).
const importsByPkg = new Map<string, Set<string>>();
for (const file of allFiles) {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const record = (spec: string) => {
    if (!/^(@solana|@solana-program|@coral-xyz|@jup-ag|@pythnetwork|@project-serum)/.test(spec)) return;
    (importsByPkg.get(spec) ?? importsByPkg.set(spec, new Set()).get(spec)!).add(relative(ROOT, file));
  };
  const visit = (n: ts.Node) => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) record(n.moduleSpecifier.text);
    if (ts.isCallExpression(n) && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0]) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require"))) record(n.arguments[0].text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

// 2. `any` in exported API surface, resolved with the real type checker.
const program = ts.createProgram(sdkFiles, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true, noEmit: true, allowJs: false, baseUrl: ROOT, paths: { "@/*": ["./*"] }, resolveJsonModule: true, jsx: ts.JsxEmit.Preserve });
const checker = program.getTypeChecker();
const anyExports: { file: string; name: string; type: string }[] = [];
const explicitAny: Record<string, number> = {};
for (const sf of program.getSourceFiles()) {
  if (!sf.fileName.startsWith(SDK)) continue;
  const rel = relative(ROOT, sf.fileName);
  const symbol = checker.getSymbolAtLocation(sf);
  for (const exp of symbol ? checker.getExportsOfModule(symbol) : []) {
    const decl = exp.valueDeclaration ?? exp.declarations?.[0];
    if (!decl || decl.getSourceFile() !== sf) continue;
    let text = "";
    try {
      if (exp.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias)) {
        // Types: look at the declared type's members (the symbol's value type is always `any`).
        const declared = checker.getDeclaredTypeOfSymbol(exp);
        if (!(declared.flags & ts.TypeFlags.Object)) continue; // string/number unions are not an any risk
        const parts = checker.getPropertiesOfType(declared).map((p) => `${p.name}: ${checker.typeToString(checker.getTypeOfSymbolAtLocation(p, decl), undefined, ts.TypeFormatFlags.NoTruncation)}`);
        text = parts.filter((p) => /\bany\b/.test(p)).join("; ");
      } else if (exp.flags & ts.SymbolFlags.Value) {
        text = checker.typeToString(checker.getTypeOfSymbolAtLocation(exp, decl), undefined, ts.TypeFormatFlags.NoTruncation);
      }
    } catch { /* unresolvable export */ }
    if (/\bany\b/.test(text)) anyExports.push({ file: rel, name: exp.name, type: text.length > 110 ? `${text.slice(0, 107)}...` : text });
  }
  let count = 0;
  const visit = (n: ts.Node) => { if (n.kind === ts.SyntaxKind.AnyKeyword) count += 1; ts.forEachChild(n, visit); };
  visit(sf);
  if (count) explicitAny[rel] = count;
}

// 3. Size debt and test mapping.
const big = sdkFiles.map((f) => [relative(ROOT, f), readFileSync(f, "utf8").split("\n").length] as const).filter(([, n]) => n > 400).sort((a, b) => b[1] - a[1]);

const result = {
  packages: Object.fromEntries([...importsByPkg].map(([k, v]) => [k, [...v].sort()])),
  exportedAny: anyExports,
  explicitAnyKeywordsByFile: explicitAny,
  explicitAnyTotal: Object.values(explicitAny).reduce((a, b) => a + b, 0),
  filesOver400: big,
  sdkLines: sdkFiles.reduce((a, f) => a + readFileSync(f, "utf8").split("\n").length, 0),
};
if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
else {
  console.log("== external packages (files using each)");
  for (const [k, v] of Object.entries(result.packages)) console.log(`${String(v.length).padStart(4)}  ${k}`);
  console.log(`\n== exported symbols whose type mentions any: ${anyExports.length}`);
  for (const e of anyExports.slice(0, 40)) console.log(`  ${e.file} :: ${e.name} :: ${e.type}`);
  console.log(`\n== explicit 'any' keywords: ${result.explicitAnyTotal}`);
  for (const [f, n] of Object.entries(explicitAny).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${f}`);
  console.log(`\n== files over 400 lines: ${big.length} (sdk total ${result.sdkLines} lines)`);
  for (const [f, n] of big) console.log(`  ${n}  ${f}`);
}
