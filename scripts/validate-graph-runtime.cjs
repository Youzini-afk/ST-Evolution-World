require("ts-node").register({
  project: "./tsconfig.json",
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
  },
});

require("../src/runtime/graph-executor.validation.spec.ts");
