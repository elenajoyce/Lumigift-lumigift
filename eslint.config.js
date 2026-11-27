import { createRequire } from "module";

// eslint-config-next v16 ships a native flat config; load it via createRequire
// to avoid FlatCompat's circular-JSON issue with the plugin registry.
const require = createRequire(import.meta.url);
const nextFlatBase = require("./node_modules/eslint-config-next/dist/index.js");
const nextFlat = Array.isArray(nextFlatBase)
  ? nextFlatBase
  : (nextFlatBase.default ?? []);

// The eslint-plugin-react version bundled in eslint-config-next v16 uses a
// deprecated context API (getFilename) that crashes in eslint flat-config mode.
// Strip react/* rules from the first config entry to avoid the crash.
// @next/next rules and TypeScript rules still apply.
const patchedNextFlat = nextFlat.map((entry, idx) => {
  if (idx === 0 && entry.rules) {
    const patchedRules = Object.fromEntries(
      Object.entries(entry.rules).filter(([key]) => !key.startsWith("react/"))
    );
    // Also drop the react plugin to prevent it from loading at all
    const { react: _reactPlugin, ...restPlugins } = entry.plugins ?? {};
    return { ...entry, plugins: restPlugins, rules: patchedRules };
  }
  return entry;
});

/** @type {import('eslint').Linter.Config[]} */
const config = [
  ...patchedNextFlat,
  // Project-specific overrides
  {
    // Issue #498: flag inline `style` props on components in favour of CSS modules.
    // (react/* rules are stripped above, so use no-restricted-syntax instead of
    // react/forbid-component-props.)
    files: ["src/components/**/*.{js,jsx,ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='style']",
          message:
            "Inline `style` props are not allowed in src/components. Move the styles to the component's *.module.css file (see issue #498).",
        },
      ],
    },
  },
  {
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "TaggedTemplateExpression[tag.name='sql']",
          message:
            "Use parameterized queries (pool.query(sql, [params])) instead of tagged template SQL literals to prevent SQL injection.",
        },
        {
          selector:
            "CallExpression[callee.property.name='query'] > TemplateLiteral:first-child",
          message:
            "Avoid template literals as the first argument to pool.query(). Use a plain string with $1/$2 placeholders and a params array to prevent SQL injection.",
        },
      ],
    },
  },
];

export default config;
