const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..', '..');

function resolveSourceFile(request, parentFilename) {
  let candidate;

  if (request.startsWith('@/')) {
    candidate = path.join(repoRoot, 'src', request.slice(2));
  } else if (request.startsWith('.')) {
    candidate = path.resolve(path.dirname(parentFilename), request);
  } else {
    return null;
  }

  const candidates = [
    candidate,
    `${candidate}.ts`,
    `${candidate}.tsx`,
    `${candidate}.js`,
    `${candidate}.jsx`,
    path.join(candidate, 'index.ts'),
    path.join(candidate, 'index.tsx'),
    path.join(candidate, 'index.js'),
  ];

  return candidates.find((file) => fs.existsSync(file) && fs.statSync(file).isFile()) || null;
}

function loadSource(relativePath, mocks = {}) {
  const cache = new Map();
  const entry = path.resolve(repoRoot, relativePath);

  function load(filename) {
    const resolved = path.resolve(filename);
    if (cache.has(resolved)) return cache.get(resolved).exports;

    const ext = path.extname(resolved);
    if (ext === '.css') return {};

    const source = fs.readFileSync(resolved, 'utf8');
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        allowJs: true,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
      fileName: resolved,
    }).outputText;

    const mod = new Module(resolved, module.parent);
    mod.filename = resolved;
    mod.paths = Module._nodeModulePaths(path.dirname(resolved));
    cache.set(resolved, mod);

    const originalRequire = mod.require.bind(mod);
    mod.require = (request) => {
      if (Object.prototype.hasOwnProperty.call(mocks, request)) {
        return mocks[request];
      }
      const sourceFile = resolveSourceFile(request, resolved);
      if (sourceFile) return load(sourceFile);
      return originalRequire(request);
    };

    mod._compile(transpiled, resolved);
    return mod.exports;
  }

  return load(entry);
}

module.exports = { loadSource, repoRoot };
