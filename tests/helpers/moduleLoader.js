const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const projectRoot = path.resolve(__dirname, '..', '..');

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function findExistingModuleFile(target) {
  const candidates = [
    target,
    `${target}.ts`,
    `${target}.tsx`,
    `${target}.js`,
    `${target}.jsx`,
    path.join(target, 'index.ts'),
    path.join(target, 'index.tsx'),
    path.join(target, 'index.js'),
    path.join(target, 'index.jsx')
  ];

  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

function loadResolved(target, mocks) {
  const filename = findExistingModuleFile(target);
  if (!filename) {
    throw new Error(`Unable to resolve module at ${target}`);
  }
  return loadModule(path.relative(projectRoot, filename), { mocks });
}

function loadModule(relativePath, options = {}) {
  const mocks = options.mocks || {};
  const filename = path.resolve(projectRoot, relativePath);
  const dirname = path.dirname(filename);
  const source = fs.readFileSync(filename, 'utf8');

  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      allowJs: true,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019
    }
  }).outputText;

  const module = { exports: {} };

  function localRequire(request) {
    if (hasOwn(mocks, request)) {
      return mocks[request];
    }

    if (request.endsWith('.css') || request.endsWith('.scss') || request.endsWith('.sass')) {
      return {};
    }

    if (request.startsWith('@/')) {
      return loadResolved(path.join(projectRoot, 'src', request.slice(2)), mocks);
    }

    if (request.startsWith('.')) {
      return loadResolved(path.resolve(dirname, request), mocks);
    }

    return require(request);
  }

  const wrapped = new Function('exports', 'require', 'module', '__filename', '__dirname', output);
  wrapped(module.exports, localRequire, module, filename, dirname);
  return module.exports;
}

module.exports = { loadModule, projectRoot };
