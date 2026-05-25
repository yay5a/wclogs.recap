import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const SOURCE_ROOTS = ['apps', 'packages'];
const IGNORED_DIRS = new Set(['node_modules', 'dist', '.git']);
const SOURCE_FILE_RE = /\.(ts|tsx)$/;
const SKIP_FILE_RE = /(\.d\.ts|\.test\.(ts|tsx)|\.spec\.(ts|tsx))$/;
const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;

const toPosix = (value) => value.split(path.sep).join('/');

const files = [];

const walk = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;

    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }

    if (SOURCE_FILE_RE.test(entry.name) && !SKIP_FILE_RE.test(entry.name)) {
      files.push(toPosix(fullPath));
    }
  }
};

for (const root of SOURCE_ROOTS) {
  if (statSync(root, { throwIfNoEntry: false })?.isDirectory()) walk(root);
}

const fileSet = new Set(files);
const moduleByKey = new Map();
for (const file of files) {
  const withoutExtension = file.replace(/\.(ts|tsx)$/, '');
  moduleByKey.set(withoutExtension, file);
  if (withoutExtension.endsWith('/index')) {
    moduleByKey.set(withoutExtension.slice(0, -'/index'.length), file);
  }
}

const resolvePackageImport = (specifier) => {
  const match = specifier.match(/^@wcl\/([^/]+)(?:\/(.+))?$/);
  if (!match) return null;

  const packageName = match[1];
  const deepPath = match[2];
  const basePath = deepPath
    ? `packages/${packageName}/src/${deepPath.replace(/\.js$/, '')}`
    : `packages/${packageName}/src/index`;

  return moduleByKey.get(basePath) ?? null;
};

const resolveRelativeImport = (fromFile, specifier) => {
  if (!specifier.startsWith('.')) return null;

  const resolved = toPosix(path.normalize(path.join(path.dirname(fromFile), specifier))).replace(
    /\.js$/,
    '',
  );
  return moduleByKey.get(resolved) ?? moduleByKey.get(`${resolved}/index`) ?? null;
};

const resolveInternalImport = (fromFile, specifier) =>
  resolveRelativeImport(fromFile, specifier) ?? resolvePackageImport(specifier);

const outgoing = new Map(files.map((file) => [file, new Set()]));
const incoming = new Map(files.map((file) => [file, new Set()]));
const importCounts = new Map(files.map((file) => [file, 0]));

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const matches = [...text.matchAll(IMPORT_RE)];
  importCounts.set(file, matches.length);

  for (const match of matches) {
    const target = resolveInternalImport(file, match[1]);
    if (!target || target === file || !fileSet.has(target)) continue;

    outgoing.get(file).add(target);
    incoming.get(target).add(file);
  }
}

const rows = files
  .map((file) => {
    const ce = outgoing.get(file).size;
    const ca = incoming.get(file).size;
    return {
      file,
      ic: importCounts.get(file),
      ce,
      ca,
      instability: ce + ca === 0 ? 0 : ce / (ce + ca),
    };
  })
  .sort((left, right) => {
    const leftScore = left.ic + left.ce + left.ca;
    const rightScore = right.ic + right.ce + right.ca;
    return rightScore - leftScore || left.file.localeCompare(right.file);
  });

console.log('IC  Ce  Ca   I     File');
console.log('--  --  --  ----  ----');
for (const row of rows.slice(0, 40)) {
  console.log(
    `${String(row.ic).padStart(2)}  ${String(row.ce).padStart(2)}  ${String(row.ca).padStart(2)}  ${row.instability.toFixed(2)}  ${row.file}`,
  );
}
