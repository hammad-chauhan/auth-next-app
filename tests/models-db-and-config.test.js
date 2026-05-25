const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule, projectRoot } = require('./helpers/moduleLoader');

test('user model creates the users model when no cached model exists', () => {
  let schemaDefinition;
  let modelCall;

  function Schema(definition) {
    schemaDefinition = definition;
    this.definition = definition;
  }

  const mongoose = {
    Schema,
    models: {},
    model: (name, schema) => {
      modelCall = { name, schema };
      return { modelName: name, schema };
    }
  };

  const User = loadModule('src/models/userModel.js', { mocks: { mongoose } }).default;

  assert.equal(User.modelName, 'users');
  assert.equal(modelCall.name, 'users');
  assert.ok(schemaDefinition);
});

test('user model reuses an existing cached users model', () => {
  const existingModel = { modelName: 'cached-users' };
  let modelCalled = false;

  function Schema(definition) {
    this.definition = definition;
  }

  const mongoose = {
    Schema,
    models: { users: existingModel },
    model: () => {
      modelCalled = true;
      return { modelName: 'new-users' };
    }
  };

  const User = loadModule('src/models/userModel.js', { mocks: { mongoose } }).default;

  assert.equal(User, existingModel);
  assert.equal(modelCalled, false);
});

test('user schema marks username, email, and password as required fields', () => {
  let schemaDefinition;

  function Schema(definition) {
    schemaDefinition = definition;
  }

  const mongoose = { Schema, models: {}, model: (name) => ({ modelName: name }) };
  loadModule('src/models/userModel.js', { mocks: { mongoose } });

  assert.ok(Array.isArray(schemaDefinition.username.required));
  assert.ok(Array.isArray(schemaDefinition.email.required));
  assert.ok(Array.isArray(schemaDefinition.password.required));
});

test('user schema keeps username and email unique', () => {
  let schemaDefinition;

  function Schema(definition) {
    schemaDefinition = definition;
  }

  const mongoose = { Schema, models: {}, model: (name) => ({ modelName: name }) };
  loadModule('src/models/userModel.js', { mocks: { mongoose } });

  assert.equal(schemaDefinition.username.unique, true);
  assert.equal(schemaDefinition.email.unique, true);
});

test('user schema defaults verification and admin flags to false', () => {
  let schemaDefinition;

  function Schema(definition) {
    schemaDefinition = definition;
  }

  const mongoose = { Schema, models: {}, model: (name) => ({ modelName: name }) };
  loadModule('src/models/userModel.js', { mocks: { mongoose } });

  assert.equal(schemaDefinition.isVerfied.default, false);
  assert.equal(schemaDefinition.isAdmin.default, false);
});

test('database connect uses the configured MongoDB URI and registers connection handlers', () => {
  const previousUri = process.env.MONGO_URI;
  process.env.MONGO_URI = 'mongodb://unit-test-db';

  const connectCalls = [];
  const eventHandlers = {};
  const mongoose = {
    connect: (uri) => connectCalls.push(uri),
    connection: {
      on: (eventName, handler) => {
        eventHandlers[eventName] = handler;
      }
    }
  };

  const connect = loadModule('src/dbConfig/dbConfig.ts', { mocks: { mongoose } }).default;
  connect();

  assert.deepEqual(connectCalls, ['mongodb://unit-test-db']);
  assert.equal(typeof eventHandlers.connected, 'function');
  assert.equal(typeof eventHandlers.error, 'function');

  process.env.MONGO_URI = previousUri;
});

test('database connected handler logs without throwing', () => {
  const previousLog = console.log;
  const logs = [];
  const eventHandlers = {};
  console.log = (...args) => logs.push(args.join(' '));

  const mongoose = {
    connect: () => {},
    connection: {
      on: (eventName, handler) => {
        eventHandlers[eventName] = handler;
      }
    }
  };

  const connect = loadModule('src/dbConfig/dbConfig.ts', { mocks: { mongoose } }).default;
  connect();
  eventHandlers.connected();

  assert.ok(logs.length >= 1);
  console.log = previousLog;
});

test('database connect catches synchronous connection failures', () => {
  const previousLog = console.log;
  const logs = [];
  console.log = (...args) => logs.push(args.join(' '));

  const mongoose = {
    connect: () => { throw new Error('connection failed'); },
    connection: { on: () => {} }
  };

  const connect = loadModule('src/dbConfig/dbConfig.ts', { mocks: { mongoose } }).default;

  assert.doesNotThrow(() => connect());
  assert.ok(logs.length >= 1);
  console.log = previousLog;
});

test('tailwind config scans the application source tree', () => {
  const config = loadModule('tailwind.config.ts').default;

  assert.ok(config.content.some((entry) => entry.includes('./src/app/')));
  assert.ok(config.content.some((entry) => entry.includes('./src/components/')));
  assert.ok(config.content.some((entry) => entry.includes('./src/pages/')));
});

test('tailwind config defines the radial and conic background helpers used by the home page', () => {
  const config = loadModule('tailwind.config.ts').default;

  assert.ok(config.theme.extend.backgroundImage['gradient-radial'].includes('radial-gradient'));
  assert.ok(config.theme.extend.backgroundImage['gradient-conic'].includes('conic-gradient'));
});

test('postcss config enables tailwindcss and autoprefixer plugins', () => {
  const config = require(path.join(projectRoot, 'postcss.config.js'));

  assert.ok(config.plugins.tailwindcss);
  assert.ok(config.plugins.autoprefixer);
});

test('next config exports an object configuration', () => {
  const config = require(path.join(projectRoot, 'next.config.js'));

  assert.equal(typeof config, 'object');
  assert.ok(config);
});

test('package metadata exposes the expected project scripts and core dependencies', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

  assert.equal(packageJson.name, 'auth-app-nextjs');
  for (const scriptName of ['dev', 'build', 'start', 'lint']) {
    assert.equal(typeof packageJson.scripts[scriptName], 'string');
  }
  for (const dependency of ['next', 'react', 'react-dom', 'mongoose', 'bcryptjs', 'jsonwebtoken']) {
    assert.ok(packageJson.dependencies[dependency]);
  }
});
