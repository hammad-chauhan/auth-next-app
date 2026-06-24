const assert = require("node:assert/strict");
const { loadSourceModule } = require("./helpers/moduleLoader");

const describeFn = global.describe || require("node:test").describe;
const testFn = global.test || require("node:test").test;

describeFn("project configuration", () => {
  testFn("next config exports a plain configuration object", () => {
    const config = require("../next.config.js");
    assert.equal(typeof config, "object");
    assert.deepEqual(config, {});
  });

  testFn("postcss config enables tailwindcss and autoprefixer plugins", () => {
    const config = require("../postcss.config.js");
    assert.ok(config.plugins.tailwindcss);
    assert.ok(config.plugins.autoprefixer);
  });

  testFn("tailwind config scans app, pages, and components source trees", () => {
    const mod = loadSourceModule("tailwind.config.ts");
    const config = mod.default || mod;
    assert.ok(config.content.some((entry) => entry.includes("src/app")));
    assert.ok(config.content.some((entry) => entry.includes("src/pages")));
    assert.ok(config.content.some((entry) => entry.includes("src/components")));
  });

  testFn("tailwind config exposes the custom radial and conic background images", () => {
    const mod = loadSourceModule("tailwind.config.ts");
    const config = mod.default || mod;
    assert.ok(config.theme.extend.backgroundImage["gradient-radial"]);
    assert.ok(config.theme.extend.backgroundImage["gradient-conic"]);
  });
});

describeFn("user model", () => {
  function loadUserModelWithMock(mongooseMock) {
    const mod = loadSourceModule("src/models/userModel.js", { mongoose: mongooseMock });
    return mod.default || mod;
  }

  testFn("creates the users model with a schema when no cached model exists", () => {
    const calls = { model: [] };
    function Schema(definition) {
      this.definition = definition;
    }
    const mongooseMock = {
      models: {},
      Schema,
      model: (name, schema) => {
        calls.model.push({ name, schema });
        return { modelName: name, schema };
      }
    };

    const User = loadUserModelWithMock(mongooseMock);

    assert.equal(User.modelName, "users");
    assert.equal(calls.model.length, 1);
    assert.equal(calls.model[0].name, "users");
    assert.ok(calls.model[0].schema.definition.username);
    assert.ok(calls.model[0].schema.definition.email);
    assert.ok(calls.model[0].schema.definition.password);
  });

  testFn("reuses an existing users model from mongoose when present", () => {
    const existingModel = { modelName: "users", existing: true };
    function Schema(definition) {
      this.definition = definition;
    }
    const mongooseMock = {
      models: { users: existingModel },
      Schema,
      model: () => {
        throw new Error("model should not be recreated");
      }
    };

    const User = loadUserModelWithMock(mongooseMock);

    assert.equal(User, existingModel);
  });

  testFn("declares boolean defaults for verification and admin flags", () => {
    function Schema(definition) {
      this.definition = definition;
    }
    const mongooseMock = {
      models: {},
      Schema,
      model: (name, schema) => ({ modelName: name, schema })
    };

    const User = loadUserModelWithMock(mongooseMock);

    assert.equal(User.schema.definition.isVerfied.default, false);
    assert.equal(User.schema.definition.isAdmin.default, false);
  });
});

describeFn("database connection helper", () => {
  testFn("connects mongoose using the configured Mongo URI and registers connection handlers", () => {
    const originalUri = process.env.MONGO_URI;
    process.env.MONGO_URI = "mongodb://example.test/auth";
    const calls = { connect: [], on: [] };
    const mongooseMock = {
      connect: (uri) => calls.connect.push(uri),
      connection: {
        on: (event, handler) => calls.on.push({ event, handler })
      }
    };
    const mod = loadSourceModule("src/dbConfig/dbConfig.ts", { mongoose: mongooseMock });

    mod.default();

    assert.deepEqual(calls.connect, ["mongodb://example.test/auth"]);
    assert.ok(calls.on.some((entry) => entry.event === "connected"));
    assert.ok(calls.on.some((entry) => entry.event === "error"));
    process.env.MONGO_URI = originalUri;
  });

  testFn("does not throw synchronously when mongoose.connect throws", () => {
    const originalLog = console.log;
    const logs = [];
    console.log = (...args) => logs.push(args.join(" "));
    const mongooseMock = {
      connect: () => {
        throw new Error("connection failure");
      },
      connection: {
        on: () => {}
      }
    };
    const mod = loadSourceModule("src/dbConfig/dbConfig.ts", { mongoose: mongooseMock });

    assert.doesNotThrow(() => mod.default());
    assert.ok(logs.length >= 1);
    console.log = originalLog;
  });
});
