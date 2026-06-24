const assert = require("node:assert/strict");
const { loadSourceModule, createNextServerMock, makeJsonRequest, makeThrowingJsonRequest } = require("./helpers/moduleLoader");

const describeFn = global.describe || require("node:test").describe;
const testFn = global.test || require("node:test").test;

function loadSignupRoute({ existingUser = null, saveImpl, bcryptOverrides = {} } = {}) {
  const calls = { connect: 0, findOne: [], constructedUsers: [], genSalt: [], hash: [] };

  function User(data) {
    calls.constructedUsers.push(data);
    Object.assign(this, data);
    this.save = async () => {
      if (saveImpl) return saveImpl(this);
      return { _id: "saved-user-id", ...data };
    };
  }
  User.findOne = async (query) => {
    calls.findOne.push(query);
    return existingUser;
  };

  const bcryptjs = {
    genSalt: async (rounds) => {
      calls.genSalt.push(rounds);
      return "unit-test-salt";
    },
    hash: async (password, salt) => {
      calls.hash.push({ password, salt });
      return `hashed:${password}:${salt}`;
    },
    ...bcryptOverrides
  };

  const route = loadSourceModule("src/app/api/users/signup/route.ts", {
    "@/dbConfig/dbConfig": () => {
      calls.connect += 1;
    },
    "@/models/userModel": User,
    "next/server": createNextServerMock(),
    bcryptjs
  });

  return { route, calls };
}

describeFn("signup API route", () => {
  testFn("creates a new user for valid signup input", async () => {
    const { route, calls } = loadSignupRoute();
    const request = makeJsonRequest({ username: "alice", email: "alice@example.com", password: "secret" });

    const response = await route.POST(request);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.ok(body.savedUser);
    assert.equal(calls.connect, 1);
    assert.deepEqual(calls.findOne, [{ email: "alice@example.com" }]);
    assert.equal(request.jsonCalls, 1);
  });

  testFn("hashes the submitted password before saving the model", async () => {
    const { route, calls } = loadSignupRoute();

    await route.POST(makeJsonRequest({ username: "bob", email: "bob@example.com", password: "plain-password" }));

    assert.deepEqual(calls.genSalt, [10]);
    assert.deepEqual(calls.hash, [{ password: "plain-password", salt: "unit-test-salt" }]);
    assert.equal(calls.constructedUsers[0].password, "hashed:plain-password:unit-test-salt");
  });

  testFn("passes username and email through to the User model", async () => {
    const { route, calls } = loadSignupRoute();

    await route.POST(makeJsonRequest({ username: "casey", email: "casey@example.com", password: "pw" }));

    assert.equal(calls.constructedUsers.length, 1);
    assert.equal(calls.constructedUsers[0].username, "casey");
    assert.equal(calls.constructedUsers[0].email, "casey@example.com");
  });

  testFn("returns a client error when the email already exists", async () => {
    const { route, calls } = loadSignupRoute({ existingUser: { id: "existing" } });

    const response = await route.POST(makeJsonRequest({ username: "duplicate", email: "dupe@example.com", password: "pw" }));
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.ok(body.error);
    assert.equal(calls.constructedUsers.length, 0);
    assert.equal(calls.hash.length, 0);
  });

  testFn("returns a server error when request JSON parsing fails", async () => {
    const { route } = loadSignupRoute();

    const response = await route.POST(makeThrowingJsonRequest());
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.ok(body.error);
  });

  testFn("returns a server error when hashing fails", async () => {
    const { route, calls } = loadSignupRoute({
      bcryptOverrides: {
        hash: async () => {
          throw new Error("hash failure");
        }
      }
    });

    const response = await route.POST(makeJsonRequest({ username: "dana", email: "dana@example.com", password: "pw" }));
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.ok(body.error);
    assert.equal(calls.constructedUsers.length, 0);
  });

  testFn("returns a server error when saving fails", async () => {
    const { route, calls } = loadSignupRoute({
      saveImpl: async () => {
        throw new Error("save failure");
      }
    });

    const response = await route.POST(makeJsonRequest({ username: "erin", email: "erin@example.com", password: "pw" }));
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.ok(body.error);
    assert.equal(calls.constructedUsers.length, 1);
  });
});
