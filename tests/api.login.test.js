const assert = require("node:assert/strict");
const { loadSourceModule, createNextServerMock, makeJsonRequest, makeThrowingJsonRequest } = require("./helpers/moduleLoader");

const describeFn = global.describe || require("node:test").describe;
const testFn = global.test || require("node:test").test;

function loadLoginRoute({ user = { id: "user-1", username: "alice", email: "alice@example.com", password: "hashed" }, passwordValid = true, compareImpl, signImpl } = {}) {
  const calls = { connect: 0, findOne: [], compare: [], sign: [] };

  const User = {
    findOne: async (query) => {
      calls.findOne.push(query);
      return user;
    }
  };

  const bcryptjs = {
    compare: async (password, hashedPassword) => {
      calls.compare.push({ password, hashedPassword });
      if (compareImpl) return compareImpl(password, hashedPassword);
      return passwordValid;
    }
  };

  const jwt = {
    sign: (payload, secret, options) => {
      calls.sign.push({ payload, secret, options });
      if (signImpl) return signImpl(payload, secret, options);
      return "signed.jwt.token";
    }
  };

  const originalSecret = process.env.TOKEN_SECRET;
  process.env.TOKEN_SECRET = "test-token-secret";
  const route = loadSourceModule("src/app/api/users/login/route.ts", {
    "@/dbConfig/dbConfig": () => {
      calls.connect += 1;
    },
    "@/models/userModel": User,
    "next/server": createNextServerMock(),
    bcryptjs,
    jsonwebtoken: jwt
  });
  process.env.TOKEN_SECRET = originalSecret;

  return { route, calls };
}

describeFn("login API route", () => {
  testFn("logs in an existing user with a valid password", async () => {
    const { route, calls } = loadLoginRoute();
    process.env.TOKEN_SECRET = "test-token-secret";

    const response = await route.POST(makeJsonRequest({ email: "alice@example.com", password: "secret" }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(calls.connect, 1);
    assert.deepEqual(calls.findOne, [{ email: "alice@example.com" }]);
    assert.deepEqual(calls.compare, [{ password: "secret", hashedPassword: "hashed" }]);
  });

  testFn("sets an httpOnly token cookie after successful login", async () => {
    const { route } = loadLoginRoute();
    process.env.TOKEN_SECRET = "test-token-secret";

    const response = await route.POST(makeJsonRequest({ email: "alice@example.com", password: "secret" }));

    assert.equal(response.cookies.setCalls.length, 1);
    assert.equal(response.cookies.setCalls[0].name, "token");
    assert.equal(response.cookies.setCalls[0].value, "signed.jwt.token");
    assert.equal(response.cookies.setCalls[0].options.httpOnly, true);
  });

  testFn("signs a token containing the authenticated user's public identity", async () => {
    const { route, calls } = loadLoginRoute({ user: { id: "42", username: "zoe", email: "zoe@example.com", password: "stored" } });
    process.env.TOKEN_SECRET = "another-secret";

    await route.POST(makeJsonRequest({ email: "zoe@example.com", password: "pw" }));

    assert.equal(calls.sign.length, 1);
    assert.deepEqual(calls.sign[0].payload, { id: "42", username: "zoe", email: "zoe@example.com" });
    assert.equal(calls.sign[0].secret, "another-secret");
    assert.deepEqual(calls.sign[0].options, { expiresIn: "1d" });
  });

  testFn("returns a client error when no user is found", async () => {
    const { route, calls } = loadLoginRoute({ user: null });

    const response = await route.POST(makeJsonRequest({ email: "missing@example.com", password: "pw" }));
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.ok(body.error);
    assert.equal(calls.compare.length, 0);
    assert.equal(calls.sign.length, 0);
  });

  testFn("returns a client error when password comparison fails", async () => {
    const { route, calls } = loadLoginRoute({ passwordValid: false });

    const response = await route.POST(makeJsonRequest({ email: "alice@example.com", password: "wrong" }));
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.ok(body.error);
    assert.equal(calls.compare.length, 1);
    assert.equal(calls.sign.length, 0);
    assert.equal(response.cookies.setCalls.length, 0);
  });

  testFn("returns a server error when request JSON parsing fails", async () => {
    const { route } = loadLoginRoute();

    const response = await route.POST(makeThrowingJsonRequest());
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.ok(body.error);
  });

  testFn("returns a server error when token signing fails", async () => {
    const { route, calls } = loadLoginRoute({
      signImpl: () => {
        throw new Error("sign failure");
      }
    });
    process.env.TOKEN_SECRET = "test-token-secret";

    const response = await route.POST(makeJsonRequest({ email: "alice@example.com", password: "secret" }));
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.ok(body.error);
    assert.equal(calls.sign.length, 1);
  });
});
