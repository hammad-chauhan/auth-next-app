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

function createSignupModule(options = {}) {
  const connectCalls = [];
  const findOneCalls = [];
  const genSaltCalls = [];
  const hashCalls = [];
  const constructedDocs = [];
  const saveCalls = [];

  const connect = () => {
    connectCalls.push(true);
  };

  function User(doc) {
    constructedDocs.push(doc);
    this.save = async () => {
      saveCalls.push(doc);
      if (options.saveRejects) {
        throw options.saveRejects;
      }
      return options.savedUser || { id: 'saved-user-id', ...doc };
    };
  }

  User.findOne = async (query) => {
    findOneCalls.push(query);
    if (options.findOneRejects) {
      throw options.findOneRejects;
    }
    return options.existingUser || null;
  };

  const bcryptjs = {
    genSalt: async (rounds) => {
      genSaltCalls.push(rounds);
      return options.salt || 'unit-test-salt';
    },
    hash: async (password, salt) => {
      hashCalls.push({ password, salt });
      return options.hashedPassword || `hashed:${password}:${salt}`;
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

  const connect = () => {
    connectCalls.push(true);
  };

  function User() {}
  User.findOne = async (query) => {
    findOneCalls.push(query);
    if (options.findOneRejects) {
      throw options.findOneRejects;
    }
    return options.user === undefined ? {
      id: 'user-123',
      username: 'alice',
      email: query.email,
      password: 'stored-password-hash'
    } : options.user;
  };

  const bcryptjs = {
    compare: async (password, storedHash) => {
      compareCalls.push({ password, storedHash });
      if (options.compareRejects) {
        throw options.compareRejects;
      }
      return options.validPassword !== undefined ? options.validPassword : true;
    }
  };

  const jwt = {
    sign: (payload, secret, jwtOptions) => {
      signCalls.push({ payload, secret, jwtOptions });
      if (options.signThrows) {
        throw options.signThrows;
      }
      return options.token || 'signed-login-token';
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

test('signup creates a new user and returns a successful JSON response', async () => {
  const { POST, calls } = createSignupModule();
  const response = await POST(makeJsonRequest({ username: 'alice', email: 'alice@example.com', password: 'secret' }));
  const body = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.ok(body.savedUser);
  assert.equal(calls.findOneCalls.length, 1);
  assert.deepEqual(calls.findOneCalls[0], { email: 'alice@example.com' });
  assert.equal(calls.saveCalls.length, 1);
});

test('signup hashes the supplied password before constructing the user', async () => {
  const { POST, calls } = createSignupModule({ hashedPassword: 'safe-hash' });
  await POST(makeJsonRequest({ username: 'bob', email: 'bob@example.com', password: 'plain-password' }));

  assert.deepEqual(calls.genSaltCalls, [10]);
  assert.deepEqual(calls.hashCalls, [{ password: 'plain-password', salt: 'unit-test-salt' }]);
  assert.equal(calls.constructedDocs[0].password, 'safe-hash');
});

test('signup preserves submitted username and email when saving', async () => {
  const { POST, calls } = createSignupModule();
  await POST(makeJsonRequest({ username: 'carol', email: 'carol@example.com', password: 'pw' }));

  assert.equal(calls.constructedDocs[0].username, 'carol');
  assert.equal(calls.constructedDocs[0].email, 'carol@example.com');
});

test('signup returns a bad request when the email already exists', async () => {
  const { POST, calls } = createSignupModule({ existingUser: { id: 'existing' } });
  const response = await POST(makeJsonRequest({ username: 'dana', email: 'dana@example.com', password: 'pw' }));
  const body = await readJson(response);

  assert.equal(response.status, 400);
  assert.ok(body.error);
  assert.equal(calls.genSaltCalls.length, 0);
  assert.equal(calls.constructedDocs.length, 0);
});

test('signup returns a server error if saving the user fails', async () => {
  const { POST } = createSignupModule({ saveRejects: new Error('save failed') });
  const response = await POST(makeJsonRequest({ username: 'erin', email: 'erin@example.com', password: 'pw' }));
  const body = await readJson(response);

  assert.equal(response.status, 500);
  assert.ok(body.error);
});

test('signup returns a server error if request JSON parsing fails', async () => {
  const { POST } = createSignupModule();
  const response = await POST({ json: async () => { throw new Error('bad json'); } });
  const body = await readJson(response);

  assert.equal(response.status, 500);
  assert.ok(body.error);
});

test('login authenticates a valid user and sets an http-only token cookie', async () => {
  const { POST, calls } = createLoginModule({ token: 'cookie-token' });
  const response = await POST(makeJsonRequest({ email: 'alice@example.com', password: 'secret' }));
  const body = await readJson(response);
  const cookieHeader = response.headers.get('set-cookie');

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.ok(cookieHeader.includes('token=cookie-token'));
  assert.ok(/httponly/i.test(cookieHeader));
  assert.equal(calls.compareCalls.length, 1);
  assert.equal(calls.signCalls.length, 1);
});

test('login looks up users by the submitted email address', async () => {
  const { POST, calls } = createLoginModule();
  await POST(makeJsonRequest({ email: 'lookup@example.com', password: 'secret' }));

  assert.deepEqual(calls.findOneCalls, [{ email: 'lookup@example.com' }]);
});

test('login compares the submitted password against the stored hash', async () => {
  const user = { id: 'u-1', username: 'hash-user', email: 'hash@example.com', password: 'stored-hash' };
  const { POST, calls } = createLoginModule({ user });
  await POST(makeJsonRequest({ email: 'hash@example.com', password: 'candidate-password' }));

  assert.deepEqual(calls.compareCalls, [{ password: 'candidate-password', storedHash: 'stored-hash' }]);
});

test('login signs a token containing public user identity fields', async () => {
  const user = { id: 'identity-id', username: 'identity-user', email: 'identity@example.com', password: 'stored' };
  const { POST, calls } = createLoginModule({ user, tokenSecret: 'identity-secret' });
  await POST(makeJsonRequest({ email: 'identity@example.com', password: 'pw' }));

  assert.deepEqual(calls.signCalls[0].payload, {
    id: 'identity-id',
    username: 'identity-user',
    email: 'identity@example.com'
  });
  assert.equal(calls.signCalls[0].secret, 'identity-secret');
  assert.deepEqual(calls.signCalls[0].jwtOptions, { expiresIn: '1d' });
});

test('login returns a bad request when no user is found', async () => {
  const { POST, calls } = createLoginModule({ user: null });
  const response = await POST(makeJsonRequest({ email: 'missing@example.com', password: 'pw' }));
  const body = await readJson(response);

  assert.equal(response.status, 400);
  assert.ok(body.error);
  assert.equal(calls.compareCalls.length, 0);
  assert.equal(calls.signCalls.length, 0);
});

test('login returns a bad request for an invalid password', async () => {
  const { POST, calls } = createLoginModule({ validPassword: false });
  const response = await POST(makeJsonRequest({ email: 'alice@example.com', password: 'wrong' }));
  const body = await readJson(response);

  assert.equal(response.status, 400);
  assert.ok(body.error);
  assert.equal(calls.signCalls.length, 0);
});

test('login returns a server error when token signing fails', async () => {
  const { POST } = createLoginModule({ signThrows: new Error('sign failed') });
  const response = await POST(makeJsonRequest({ email: 'alice@example.com', password: 'secret' }));
  const body = await readJson(response);

  assert.equal(response.status, 500);
  assert.ok(body.error);
});

test('login returns a server error if request JSON parsing fails', async () => {
  const { POST } = createLoginModule();
  const response = await POST({ json: async () => { throw new Error('bad json'); } });
  const body = await readJson(response);

  assert.equal(response.status, 500);
  assert.ok(body.error);
});
