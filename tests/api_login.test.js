const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadSource } = require('./helpers/loadSource');

function makeNextServerMock() {
  return {
    NextResponse: {
      json(data, init = {}) {
        return {
          status: init.status || 200,
          body: data,
          async json() {
            return data;
          },
          cookies: {
            values: [],
            set(name, value, options) {
              this.values.push({ name, value, options });
            },
          },
        };
      },
    },
  };
}

function makeRequest(body, options = {}) {
  return {
    async json() {
      if (options.throwJson) throw new Error('json failed');
      return body;
    },
  };
}

function makeLoginModule({ user = { id: 'u1', username: 'Ada', email: 'ada@example.com', password: 'stored-hash' }, passwordValid = true, findOneImpl, compareImpl, signImpl } = {}) {
  class UserMock {
    static async findOne(query) {
      UserMock.queries.push(query);
      if (findOneImpl) return findOneImpl(query);
      return user;
    }
  }
  UserMock.queries = [];

  const bcryptMock = {
    compareCalls: [],
    async compare(password, storedPassword) {
      this.compareCalls.push({ password, storedPassword });
      if (compareImpl) return compareImpl(password, storedPassword);
      return passwordValid;
    },
  };

  const jwtMock = {
    signCalls: [],
    sign(payload, secret, options) {
      this.signCalls.push({ payload, secret, options });
      if (signImpl) return signImpl(payload, secret, options);
      return 'signed.jwt.token';
    },
  };

  const connectCalls = [];
  const route = loadSource('src/app/api/users/login/route.ts', {
    '@/dbConfig/dbConfig': () => connectCalls.push('connected'),
    '@/models/userModel': UserMock,
    bcryptjs: bcryptMock,
    jsonwebtoken: jwtMock,
    'next/server': makeNextServerMock(),
  });

  return { route, UserMock, bcryptMock, jwtMock, connectCalls };
}

describe('login API route', () => {
  beforeEach(() => {
    process.env.TOKEN_SECRET = 'test-token-secret';
    process.env.MONGO_URI = 'mongodb://unit-test/login';
  });

  it('logs in a user with valid credentials', async () => {
    const { route } = makeLoginModule();
    const response = await route.POST(makeRequest({ email: 'ada@example.com', password: 'correct-password' }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
  });

  it('sets an httpOnly token cookie on successful login', async () => {
    const { route } = makeLoginModule();
    const response = await route.POST(makeRequest({ email: 'ada@example.com', password: 'correct-password' }));

    assert.equal(response.cookies.values.length, 1);
    assert.equal(response.cookies.values[0].name, 'token');
    assert.equal(response.cookies.values[0].value, 'signed.jwt.token');
    assert.equal(response.cookies.values[0].options.httpOnly, true);
  });

  it('looks up the user by the submitted email address', async () => {
    const { route, UserMock } = makeLoginModule();
    await route.POST(makeRequest({ email: 'lookup@example.com', password: 'pw' }));

    assert.deepEqual(UserMock.queries, [{ email: 'lookup@example.com' }]);
  });

  it('compares the submitted password with the stored password', async () => {
    const { route, bcryptMock } = makeLoginModule({ user: { id: 'u2', username: 'Grace', email: 'grace@example.com', password: 'stored-password' } });
    await route.POST(makeRequest({ email: 'grace@example.com', password: 'submitted-password' }));

    assert.deepEqual(bcryptMock.compareCalls, [{ password: 'submitted-password', storedPassword: 'stored-password' }]);
  });

  it('signs a token containing the authenticated user identity', async () => {
    const { route, jwtMock } = makeLoginModule({ user: { id: 'u3', username: 'Katherine', email: 'kat@example.com', password: 'hash' } });
    await route.POST(makeRequest({ email: 'kat@example.com', password: 'pw' }));

    assert.equal(jwtMock.signCalls.length, 1);
    assert.deepEqual(jwtMock.signCalls[0].payload, { id: 'u3', username: 'Katherine', email: 'kat@example.com' });
    assert.equal(jwtMock.signCalls[0].secret, 'test-token-secret');
    assert.deepEqual(jwtMock.signCalls[0].options, { expiresIn: '1d' });
  });

  it('returns a client error when no user exists for the email', async () => {
    const { route } = makeLoginModule({ user: null });
    const response = await route.POST(makeRequest({ email: 'missing@example.com', password: 'pw' }));
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.ok(body.error);
    assert.equal(response.cookies.values.length, 0);
  });

  it('returns a client error when the password is invalid', async () => {
    const { route } = makeLoginModule({ passwordValid: false });
    const response = await route.POST(makeRequest({ email: 'ada@example.com', password: 'wrong-password' }));
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.ok(body.error);
    assert.equal(response.cookies.values.length, 0);
  });

  it('returns a server error response when token signing fails', async () => {
    const { route } = makeLoginModule({
      signImpl: () => {
        throw new Error('sign failed');
      },
    });
    const response = await route.POST(makeRequest({ email: 'ada@example.com', password: 'correct-password' }));
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.ok(body.error);
  });

  it('returns a server error response when the request JSON cannot be read', async () => {
    const { route } = makeLoginModule();
    const response = await route.POST(makeRequest(null, { throwJson: true }));
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.ok(body.error);
  });
});
