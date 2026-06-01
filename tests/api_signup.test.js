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

function makeSignupModule({ existingUser = null, saveImpl } = {}) {
  const savedDocuments = [];

  class UserMock {
    constructor(data) {
      this.data = data;
      Object.assign(this, data);
    }

    async save() {
      if (saveImpl) return saveImpl(this);
      const saved = { id: 'saved-user-id', ...this.data };
      savedDocuments.push(saved);
      return saved;
    }

    static async findOne(query) {
      UserMock.queries.push(query);
      return existingUser;
    }
  }
  UserMock.queries = [];

  const bcryptMock = {
    saltRounds: [],
    hashCalls: [],
    async genSalt(rounds) {
      this.saltRounds.push(rounds);
      return 'unit-test-salt';
    },
    async hash(password, salt) {
      this.hashCalls.push({ password, salt });
      return `hashed:${password}:${salt}`;
    },
  };

  const connectCalls = [];
  const route = loadSource('src/app/api/users/signup/route.ts', {
    '@/dbConfig/dbConfig': () => connectCalls.push('connected'),
    '@/models/userModel': UserMock,
    bcryptjs: bcryptMock,
    'next/server': makeNextServerMock(),
  });

  return { route, UserMock, bcryptMock, connectCalls, savedDocuments };
}

describe('signup API route', () => {
  beforeEach(() => {
    process.env.MONGO_URI = 'mongodb://unit-test/signup';
  });

  it('creates a new user and returns a successful JSON response', async () => {
    const { route } = makeSignupModule();
    const response = await route.POST(makeRequest({ username: 'Ada', email: 'ada@example.com', password: 'secret' }));

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.savedUser.username, 'Ada');
    assert.equal(body.savedUser.email, 'ada@example.com');
  });

  it('hashes the password before saving the user', async () => {
    const { route } = makeSignupModule();
    const response = await route.POST(makeRequest({ username: 'Grace', email: 'grace@example.com', password: 'plain-text' }));
    const body = await response.json();

    assert.equal(body.savedUser.password, 'hashed:plain-text:unit-test-salt');
    assert.notEqual(body.savedUser.password, 'plain-text');
  });

  it('uses bcrypt with ten salt rounds for the signup flow', async () => {
    const { route, bcryptMock } = makeSignupModule();
    await route.POST(makeRequest({ username: 'Linus', email: 'linus@example.com', password: 'kernel' }));

    assert.deepEqual(bcryptMock.saltRounds, [10]);
    assert.deepEqual(bcryptMock.hashCalls, [{ password: 'kernel', salt: 'unit-test-salt' }]);
  });

  it('checks for an existing account by email before saving', async () => {
    const { route, UserMock, savedDocuments } = makeSignupModule();
    await route.POST(makeRequest({ username: 'Marie', email: 'marie@example.com', password: 'radium' }));

    assert.deepEqual(UserMock.queries, [{ email: 'marie@example.com' }]);
    assert.equal(savedDocuments.length, 1);
  });

  it('returns a client error when the email is already registered', async () => {
    const { route, savedDocuments } = makeSignupModule({ existingUser: { id: 'already-there' } });
    const response = await route.POST(makeRequest({ username: 'Existing', email: 'exists@example.com', password: 'pw' }));
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.ok(body.error);
    assert.equal(savedDocuments.length, 0);
  });

  it('returns a server error response when saving fails', async () => {
    const { route } = makeSignupModule({
      saveImpl: async () => {
        throw new Error('database unavailable');
      },
    });
    const response = await route.POST(makeRequest({ username: 'Fail', email: 'fail@example.com', password: 'pw' }));
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.ok(body.error);
  });

  it('returns a server error response when the request body cannot be parsed', async () => {
    const { route } = makeSignupModule();
    const response = await route.POST(makeRequest(null, { throwJson: true }));
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.ok(body.error);
  });
});
