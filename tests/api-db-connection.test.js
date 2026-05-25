const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule } = require('./helpers/moduleLoader');

function makeJsonRequest(body) {
  return {
    json: async () => body
  };
}

async function readJson(response) {
  return response.json();
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createSignupModule(options = {}) {
  const connectCalls = [];
  const findOneCalls = [];
  const genSaltCalls = [];
  const hashCalls = [];
  const constructedDocs = [];
  const saveCalls = [];

  const connect = async () => {
    connectCalls.push(true);
    if (options.connectWait) {
      await options.connectWait;
    }
    if (options.connectRejects) {
      throw options.connectRejects;
    }
    return options.connectResult || { connected: true };
  };

  function User(doc) {
    constructedDocs.push(doc);
    this.save = async () => {
      saveCalls.push(doc);
      return { id: 'saved-user-id', ...doc };
    };
  }

  User.findOne = async (query) => {
    findOneCalls.push(query);
    return null;
  };

  const bcryptjs = {
    genSalt: async (rounds) => {
      genSaltCalls.push(rounds);
      return 'unit-test-salt';
    },
    hash: async (password, salt) => {
      hashCalls.push({ password, salt });
      return `hashed:${password}:${salt}`;
    }
  };

  const exports = loadModule('src/app/api/users/signup/route.ts', {
    mocks: {
      '@/dbConfig/dbConfig': connect,
      '@/models/userModel': User,
      bcryptjs
    }
  });

  return {
    POST: exports.POST,
    calls: { connectCalls, findOneCalls, genSaltCalls, hashCalls, constructedDocs, saveCalls }
  };
}

function createLoginModule(options = {}) {
  process.env.TOKEN_SECRET = options.tokenSecret || 'test-token-secret';

  const connectCalls = [];
  const findOneCalls = [];
  const compareCalls = [];
  const signCalls = [];

  const connect = async () => {
    connectCalls.push(true);
    if (options.connectWait) {
      await options.connectWait;
    }
    if (options.connectRejects) {
      throw options.connectRejects;
    }
    return options.connectResult || { connected: true };
  };

  function User() {}
  User.findOne = async (query) => {
    findOneCalls.push(query);
    return {
      id: 'user-123',
      username: 'alice',
      email: query.email,
      password: 'stored-password-hash'
    };
  };

  const bcryptjs = {
    compare: async (password, storedHash) => {
      compareCalls.push({ password, storedHash });
      return true;
    }
  };

  const jwt = {
    sign: (payload, secret, jwtOptions) => {
      signCalls.push({ payload, secret, jwtOptions });
      return 'signed-login-token';
    }
  };

  const exports = loadModule('src/app/api/users/login/route.ts', {
    mocks: {
      '@/dbConfig/dbConfig': connect,
      '@/models/userModel': User,
      bcryptjs,
      jsonwebtoken: jwt
    }
  });

  return {
    POST: exports.POST,
    calls: { connectCalls, findOneCalls, compareCalls, signCalls }
  };
}

test('signup route import does not start a database connection', () => {
  const { calls } = createSignupModule();

  assert.equal(calls.connectCalls.length, 0);
});

test('login route import does not start a database connection', () => {
  const { calls } = createLoginModule();

  assert.equal(calls.connectCalls.length, 0);
});

test('signup waits for the database connection before looking up users', async () => {
  const deferred = createDeferred();
  const { POST, calls } = createSignupModule({ connectWait: deferred.promise });

  const pendingResponse = POST(makeJsonRequest({ username: 'alice', email: 'alice@example.com', password: 'secret' }));
  await Promise.resolve();

  assert.deepEqual(calls.connectCalls, [true]);
  assert.equal(calls.findOneCalls.length, 0);
  assert.equal(calls.genSaltCalls.length, 0);

  deferred.resolve();
  const response = await pendingResponse;

  assert.equal(response.status, 200);
  assert.deepEqual(calls.findOneCalls, [{ email: 'alice@example.com' }]);
  assert.equal(calls.saveCalls.length, 1);
});

test('login waits for the database connection before looking up users', async () => {
  const deferred = createDeferred();
  const { POST, calls } = createLoginModule({ connectWait: deferred.promise });

  const pendingResponse = POST(makeJsonRequest({ email: 'alice@example.com', password: 'secret' }));
  await Promise.resolve();

  assert.deepEqual(calls.connectCalls, [true]);
  assert.equal(calls.findOneCalls.length, 0);
  assert.equal(calls.compareCalls.length, 0);
  assert.equal(calls.signCalls.length, 0);

  deferred.resolve();
  const response = await pendingResponse;

  assert.equal(response.status, 200);
  assert.deepEqual(calls.findOneCalls, [{ email: 'alice@example.com' }]);
  assert.equal(calls.compareCalls.length, 1);
  assert.equal(calls.signCalls.length, 1);
});

test('signup returns controlled JSON and skips user work when database connection fails', async () => {
  const { POST, calls } = createSignupModule({ connectRejects: new Error('database unavailable') });

  const response = await POST(makeJsonRequest({ username: 'alice', email: 'alice@example.com', password: 'secret' }));
  const body = await readJson(response);

  assert.equal(response.status, 500);
  assert.equal(body.error, 'database unavailable');
  assert.deepEqual(calls.connectCalls, [true]);
  assert.equal(calls.findOneCalls.length, 0);
  assert.equal(calls.genSaltCalls.length, 0);
  assert.equal(calls.constructedDocs.length, 0);
});

test('login returns controlled JSON and skips authentication work when database connection fails', async () => {
  const { POST, calls } = createLoginModule({ connectRejects: new Error('database unavailable') });

  const response = await POST(makeJsonRequest({ email: 'alice@example.com', password: 'secret' }));
  const body = await readJson(response);

  assert.equal(response.status, 500);
  assert.equal(body.error, 'database unavailable');
  assert.deepEqual(calls.connectCalls, [true]);
  assert.equal(calls.findOneCalls.length, 0);
  assert.equal(calls.compareCalls.length, 0);
  assert.equal(calls.signCalls.length, 0);
});
