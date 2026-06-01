const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadSource, repoRoot } = require('./helpers/loadSource');

describe('project configuration', () => {
  it('exports an object from next.config.js', () => {
    const nextConfig = require(path.join(repoRoot, 'next.config.js'));
    assert.equal(typeof nextConfig, 'object');
    assert.deepEqual(nextConfig, {});
  });

  it('configures PostCSS with Tailwind CSS and Autoprefixer plugins', () => {
    const postcssConfig = require(path.join(repoRoot, 'postcss.config.js'));

    assert.ok(postcssConfig.plugins.tailwindcss);
    assert.ok(postcssConfig.plugins.autoprefixer);
  });

  it('includes app, pages, and components paths in the Tailwind content config', () => {
    const tailwindModule = loadSource('tailwind.config.ts');
    const config = tailwindModule.default;

    assert.ok(config.content.includes('./src/app/**/*.{js,ts,jsx,tsx,mdx}'));
    assert.ok(config.content.includes('./src/pages/**/*.{js,ts,jsx,tsx,mdx}'));
    assert.ok(config.content.includes('./src/components/**/*.{js,ts,jsx,tsx,mdx}'));
  });

  it('extends Tailwind with radial and conic gradient background utilities', () => {
    const tailwindModule = loadSource('tailwind.config.ts');
    const backgroundImage = tailwindModule.default.theme.extend.backgroundImage;

    assert.equal(backgroundImage['gradient-radial'], 'radial-gradient(var(--tw-gradient-stops))');
    assert.equal(backgroundImage['gradient-conic'], 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))');
  });

  it('declares the expected package scripts', () => {
    const pkg = require(path.join(repoRoot, 'package.json'));

    assert.equal(pkg.scripts.dev, 'next dev');
    assert.equal(pkg.scripts.build, 'next build');
    assert.equal(pkg.scripts.start, 'next start');
    assert.equal(pkg.scripts.lint, 'next lint');
  });
});

describe('database connection helper', () => {
  let originalExit;
  let originalLog;

  beforeEach(() => {
    originalExit = process.exit;
    originalLog = console.log;
    console.log = () => {};
    process.env.MONGO_URI = 'mongodb://unit-test/db-config';
  });

  afterEach(() => {
    process.exit = originalExit;
    console.log = originalLog;
  });

  it('connects mongoose using the configured Mongo URI', () => {
    const calls = [];
    const mongooseMock = {
      connect(uri) {
        calls.push(uri);
      },
      connection: { on() {} },
    };
    const connect = loadSource('src/dbConfig/dbConfig.ts', { mongoose: mongooseMock }).default;

    connect();

    assert.deepEqual(calls, ['mongodb://unit-test/db-config']);
  });

  it('registers connected and error event handlers on the mongoose connection', () => {
    const registeredEvents = [];
    const mongooseMock = {
      connect() {},
      connection: {
        on(eventName, handler) {
          registeredEvents.push({ eventName, handler });
        },
      },
    };
    const connect = loadSource('src/dbConfig/dbConfig.ts', { mongoose: mongooseMock }).default;

    connect();

    assert.deepEqual(registeredEvents.map((event) => event.eventName), ['connected', 'error']);
    assert.equal(typeof registeredEvents[0].handler, 'function');
    assert.equal(typeof registeredEvents[1].handler, 'function');
  });

  it('does not throw when mongoose.connect throws synchronously', () => {
    const mongooseMock = {
      connect() {
        throw new Error('boom');
      },
      connection: { on() {} },
    };
    const connect = loadSource('src/dbConfig/dbConfig.ts', { mongoose: mongooseMock }).default;

    assert.doesNotThrow(() => connect());
  });
});

describe('user model export', () => {
  it('creates and exports the users model when no cached model exists', () => {
    const modelCalls = [];
    function Schema(definition) {
      this.definition = definition;
    }
    const mongooseMock = {
      Schema,
      models: {},
      model(name, schema) {
        modelCalls.push({ name, schema });
        return { name, schema };
      },
    };

    const modelModule = loadSource('src/models/userModel.js', { mongoose: mongooseMock });
    const User = modelModule.default;

    assert.equal(User.name, 'users');
    assert.equal(modelCalls.length, 1);
    assert.equal(modelCalls[0].name, 'users');
  });

  it('reuses an existing users model when one is already registered', () => {
    const existingModel = { alreadyRegistered: true };
    const mongooseMock = {
      Schema: function Schema(definition) {
        this.definition = definition;
      },
      models: { users: existingModel },
      model() {
        throw new Error('model should not be recreated');
      },
    };

    const modelModule = loadSource('src/models/userModel.js', { mongoose: mongooseMock });

    assert.equal(modelModule.default, existingModel);
  });

  it('defines username, email, and password fields on the user schema', () => {
    let capturedDefinition;
    function Schema(definition) {
      capturedDefinition = definition;
      this.definition = definition;
    }
    const mongooseMock = {
      Schema,
      models: {},
      model(name, schema) {
        return { name, schema };
      },
    };

    loadSource('src/models/userModel.js', { mongoose: mongooseMock });

    assert.equal(capturedDefinition.username.type, String);
    assert.equal(capturedDefinition.email.type, String);
    assert.equal(capturedDefinition.password.type, String);
    assert.ok(capturedDefinition.username.required);
    assert.ok(capturedDefinition.email.required);
    assert.ok(capturedDefinition.password.required);
  });
});
