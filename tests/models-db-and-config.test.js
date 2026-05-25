const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule, projectRoot } = require('./helpers/moduleLoader');

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function createMongooseConnectionMock(options = {}) {
  const connectCalls = [];
  const eventHandlers = {};

  const mongoose = {
    connect: (uri) => {
      connectCalls.push(uri);
      if (options.connectImpl) {
        return options.connectImpl(uri, mongoose);
      }
      return Promise.resolve(mongoose);
    },
    connection: {
      readyState: options.readyState ?? 0,
      on: (eventName, handler) => {
        if (!eventHandlers[eventName]) {
          eventHandlers[eventName] = [];
        }
        eventHandlers[eventName].push(handler);
      }
    }
  };

  return { mongoose, connectCalls, eventHandlers };
}

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

test('database connect uses the configured MongoDB URI and registers connection handlers', async () => {
  const previousUri = process.env.MONGO_URI;
  process.env.MONGO_URI = 'mongodb://unit-test-db';

  const { mongoose, connectCalls, eventHandlers } = createMongooseConnectionMock();
  const connect = loadModule('src/dbConfig/dbConfig.ts', { mocks: { mongoose } }).default;

  await connect();

  assert.deepEqual(connectCalls, ['mongodb://unit-test-db']);
  assert.equal(typeof eventHandlers.connected[0], 'function');
  assert.equal(typeof eventHandlers.error[0], 'function');

  restoreEnv('MONGO_URI', previousUri);
});

test('database connect rejects when MONGO_URI is missing and does not touch mongoose state', async () => {
  const previousUri = process.env.MONGO_URI;
  delete process.env.MONGO_URI;

  const { mongoose, connectCalls, eventHandlers } = createMongooseConnectionMock();
  const connect = loadModule('src/dbConfig/dbConfig.ts', { mocks: { mongoose } }).default;

  await assert.rejects(() => connect(), /MONGO_URI/);
  assert.equal(connectCalls.length, 0);
  assert.deepEqual(Object.keys(eventHandlers), []);

  restoreEnv('MONGO_URI', previousUri);
});

test('database connect reuses an in-flight connection promise for concurrent callers', async () => {
  const previousUri = process.env.MONGO_URI;
  process.env.MONGO_URI = 'mongodb://shared-inflight-db';

  let resolveConnect;
  const { mongoose, connectCalls, eventHandlers } = createMongooseConnectionMock({
    connectImpl: (uri, mongooseInstance) => new Promise((resolve) => {
      resolveConnect = () => resolve(mongooseInstance);
    })
  });
  const connect = loadModule('src/dbConfig/dbConfig.ts', { mocks: { mongoose } }).default;

  const first = connect();
  const second = connect();

  assert.equal(connectCalls.length, 1);
  assert.equal(eventHandlers.connected.length, 1);
  assert.equal(eventHandlers.error.length, 1);

  resolveConnect();
  assert.equal(await first, await second);

  restoreEnv('MONGO_URI', previousUri);
});

test('database connect does not register duplicate handlers after it is already connected', async () => {
  const previousUri = process.env.MONGO_URI;
  process.env.MONGO_URI = 'mongodb://already-connected-db';

  const { mongoose, connectCalls, eventHandlers } = createMongooseConnectionMock({ readyState: 1 });
  const connect = loadModule('src/dbConfig/dbConfig.ts', { mocks: { mongoose } }).default;

  const first = await connect();
  const second = await connect();

  assert.equal(first, mongoose);
  assert.equal(second, mongoose);
  assert.equal(connectCalls.length, 0);
  assert.equal(eventHandlers.connected.length, 1);
  assert.equal(eventHandlers.error.length, 1);

  restoreEnv('MONGO_URI', previousUri);
});

test('database connect clears failed pending work so a later retry can reconnect', async () => {
  const previousUri = process.env.MONGO_URI;
  process.env.MONGO_URI = 'mongodb://retry-db';

  let attempts = 0;
  const { mongoose, connectCalls } = createMongooseConnectionMock({
    connectImpl: (uri, mongooseInstance) => {
      attempts += 1;
      if (attempts === 1) {
        return Promise.reject(new Error('first attempt failed'));
      }
      return Promise.resolve(mongooseInstance);
    }
  });
  const connect = loadModule('src/dbConfig/dbConfig.ts', { mocks: { mongoose } }).default;

  await assert.rejects(() => connect(), /first attempt failed/);
  const connected = await connect();

  assert.equal(connected, mongoose);
  assert.deepEqual(connectCalls, ['mongodb://retry-db', 'mongodb://retry-db']);

  restoreEnv('MONGO_URI', previousUri);
});

test('database connected handler logs without throwing', async () => {
  const previousUri = process.env.MONGO_URI;
  const previousLog = console.log;
  const logs = [];
  process.env.MONGO_URI = 'mongodb://handler-log-db';
  console.log = (...args) => logs.push(args.join(' '));

  const { mongoose, eventHandlers } = createMongooseConnectionMock();
  const connect = loadModule('src/dbConfig/dbConfig.ts', { mocks: { mongoose } }).default;

  await connect();
  eventHandlers.connected[0]();

  assert.ok(logs.length >= 1);
  console.log = previousLog;
  restoreEnv('MONGO_URI', previousUri);
});

test('database error handler logs without exiting the process', async () => {
  const previousUri = process.env.MONGO_URI;
  const previousLog = console.log;
  const previousExit = process.exit;
  const logs = [];
  let exitCalled = false;
  process.env.MONGO_URI = 'mongodb://handler-error-db';
  console.log = (...args) => logs.push(args.join(' '));
  process.exit = () => {
    exitCalled = true;
    throw new Error('process.exit should not be called');
  };

  const { mongoose, eventHandlers } = createMongooseConnectionMock();
  const connect = loadModule('src/dbConfig/dbConfig.ts', { mocks: { mongoose } }).default;

  await connect();
  assert.doesNotThrow(() => eventHandlers.error[0](new Error('network down')));
  assert.equal(exitCalled, false);
  assert.ok(logs.some((entry) => entry.includes('network down')));

  console.log = previousLog;
  process.exit = previousExit;
  restoreEnv('MONGO_URI', previousUri);
});

test('database connect rejects synchronous connection failures', async () => {
  const previousUri = process.env.MONGO_URI;
  process.env.MONGO_URI = 'mongodb://sync-failure-db';

  const { mongoose } = createMongooseConnectionMock({
    connectImpl: () => {
      throw new Error('connection failed');
    }
  });
  const connect = loadModule('src/dbConfig/dbConfig.ts', { mocks: { mongoose } }).default;

  await assert.rejects(() => connect(), /connection failed/);

  restoreEnv('MONGO_URI', previousUri);
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
