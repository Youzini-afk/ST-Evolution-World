const Module = require("module");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(projectRoot, "src");
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function patchedResolveFilename(
  request,
  parent,
  isMain,
  options,
) {
  if (request.startsWith("@/")) {
    request = path.join(srcRoot, request.slice(2));
  }

  return originalResolveFilename.call(this, request, parent, isMain, options);
};

Object.assign(globalThis, require("vue"), require("pinia"));

require("ts-node").register({
  project: path.join(projectRoot, "tsconfig.json"),
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
  },
});

require(path.join(srcRoot, "runtime/graph-executor.validation.spec.ts"));
