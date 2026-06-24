const assert = require("node:assert/strict");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { loadSourceModule } = require("./helpers/moduleLoader");

const describeFn = global.describe || require("node:test").describe;
const testFn = global.test || require("node:test").test;

function pageMocks(pushCalls = []) {
  return {
    "next/image": (props) => React.createElement("img", props),
    "next/link": ({ href, children, ...rest }) => React.createElement("a", { href: typeof href === "string" ? href : String(href), ...rest }, children),
    "next/navigation": {
      useRouter: () => ({ push: (url) => pushCalls.push(url) })
    },
    axios: { post: async () => ({ data: {} }) },
    "react-hot-toast": {
      success: () => {},
      error: () => {},
      toast: { success: () => {}, error: () => {} }
    },
    "next/font/google": {
      Inter: () => ({ className: "mock-inter-class" })
    }
  };
}

function renderPage(modulePath, props = {}) {
  const mod = loadSourceModule(modulePath, pageMocks());
  const Component = mod.default || mod;
  return renderToStaticMarkup(React.createElement(Component, props));
}

describeFn("rendered app pages", () => {
  testFn("home page renders the starter editing guidance", () => {
    const html = renderPage("src/app/page.tsx");
    assert.match(html, /Get started by editing/);
    assert.match(html, /src\/app\/page\.tsx/);
  });

  testFn("home page renders the documented feature cards", () => {
    const html = renderPage("src/app/page.tsx");
    for (const label of ["Docs", "Learn", "Templates", "Deploy"]) {
      assert.match(html, new RegExp(label));
    }
  });

  testFn("home page includes external links that open in a new tab safely", () => {
    const html = renderPage("src/app/page.tsx");
    assert.match(html, /target="_blank"/);
    assert.match(html, /rel="noopener noreferrer"/);
    assert.match(html, /https:\/\/nextjs\.org\/docs/);
    assert.match(html, /https:\/\/vercel\.com\/new/);
  });

  testFn("home page renders both Next.js and Vercel logo images with alt text", () => {
    const html = renderPage("src/app/page.tsx");
    assert.match(html, /alt="Next\.js Logo"/);
    assert.match(html, /alt="Vercel Logo"/);
  });

  testFn("profile page renders its static heading and page copy", () => {
    const html = renderPage("src/app/profile/page.tsx");
    assert.match(html, /<h1>Profile<\/h1>/);
    assert.match(html, /Profile Page/);
  });

  testFn("dynamic profile page renders the supplied route parameter", () => {
    const html = renderPage("src/app/profile/[id]/page.tsx", { params: { id: "abc123" } });
    assert.match(html, /Profile Page of abc123/);
  });

  testFn("login page initially renders login form controls", () => {
    const html = renderPage("src/app/login/page.tsx");
    assert.match(html, /<h1>Login<\/h1>/);
    assert.match(html, /id="email"/);
    assert.match(html, /id="password"/);
    assert.match(html, /Login here/);
  });

  testFn("login page links to the signup page", () => {
    const html = renderPage("src/app/login/page.tsx");
    assert.match(html, /href="\/signup"/);
    assert.match(html, /Visit Signup Page/);
  });

  testFn("signup page initially renders signup form controls", () => {
    const html = renderPage("src/app/signup/page.tsx");
    assert.match(html, /<h1>Signup<\/h1>/);
    assert.match(html, /id="username"/);
    assert.match(html, /id="email"/);
    assert.match(html, /id="password"/);
    assert.match(html, /Signup Here/);
  });

  testFn("signup page links to the login page", () => {
    const html = renderPage("src/app/signup/page.tsx");
    assert.match(html, /href="\/login"/);
    assert.match(html, /Visit Login Page/);
  });
});

describeFn("root layout", () => {
  testFn("exports default metadata for the app shell", () => {
    const mod = loadSourceModule("src/app/layout.tsx", pageMocks());
    assert.equal(mod.metadata.title, "Create Next App");
    assert.ok(mod.metadata.description);
  });

  testFn("renders html lang and wraps children in the body", () => {
    const mod = loadSourceModule("src/app/layout.tsx", pageMocks());
    const html = renderToStaticMarkup(React.createElement(mod.default, null, React.createElement("main", null, "Child content")));
    assert.match(html, /<html lang="en">/);
    assert.match(html, /class="mock-inter-class"/);
    assert.match(html, /Child content/);
  });
});
