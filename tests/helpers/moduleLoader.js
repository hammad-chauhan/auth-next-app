const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..", "..");

function resolveSourcePath(request, fromDir) {
  let candidate;
  if (path.isAbsolute(request)) {
    candidate = request;
  } else if (request.startsWith("@/")) {
    candidate = path.join(projectRoot, "src", request.slice(2));
  } else if (request.startsWith(".")) {
    candidate = path.resolve(fromDir, request);
  } else {
    return null;
  }

  const candidates = [
    candidate,
    `${candidate}.ts`,
    `${candidate}.tsx`,
    `${candidate}.js`,
    `${candidate}.jsx`,
    `${candidate}.json`,
    path.join(candidate, "index.ts"),
    path.join(candidate, "index.tsx"),
    path.join(candidate, "index.js"),
    path.join(candidate, "index.jsx")
  ];

  return candidates.find((file) => fs.existsSync(file)) || candidate;
}

function transpile(filename, source) {
  const result = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      allowJs: true,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2019
    }
  });
  return result.outputText;
}

function loadSourceModule(relativeOrAbsolutePath, mocks = {}, cache = new Map()) {
  const filename = path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.join(projectRoot, relativeOrAbsolutePath);
  const resolved = resolveSourcePath(filename, projectRoot);

  if (cache.has(resolved)) return cache.get(resolved).exports;
  if (resolved.endsWith(".json")) return require(resolved);

  const source = fs.readFileSync(resolved, "utf8");
  const code = transpile(resolved, source);
  const module = { exports: {} };
  cache.set(resolved, module);

  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    if (request.endsWith(".css")) return {};

    const sourcePath = resolveSourcePath(request, path.dirname(resolved));
    if (sourcePath && fs.existsSync(sourcePath)) {
      return loadSourceModule(sourcePath, mocks, cache);
    }

    return require(request);
  };

  const wrapped = `(function(exports, require, module, __filename, __dirname) {\n${code}\n})`;
  const compiled = vm.runInThisContext(wrapped, { filename: resolved });
  compiled(module.exports, localRequire, module, resolved, path.dirname(resolved));
  return module.exports;
}

function createNextServerMock() {
  class MockNextResponse {
    constructor(body, init = {}) {
      this._body = body;
      this.status = init.status || 200;
      this.headers = new Map();
      this.cookies = {
        setCalls: [],
        set: (name, value, options = {}) => {
          this.cookies.setCalls.push({ name, value, options });
        }
      };
    }

    async json() {
      return this._body;
    }
  }

  return {
    NextRequest: class MockNextRequest {},
    NextResponse: {
      json: (body, init) => new MockNextResponse(body, init)
    }
  };
}

function makeJsonRequest(body) {
  return {
    jsonCalls: 0,
    async json() {
      this.jsonCalls += 1;
      return body;
    }
  };
}

function makeThrowingJsonRequest(error = new Error("json failure")) {
  return {
    async json() {
      throw error;
    }
  };
}

module.exports = {
  projectRoot,
  loadSourceModule,
  createNextServerMock,
  makeJsonRequest,
  makeThrowingJsonRequest
};
