import path from 'node:path';
import tseslint from 'typescript-eslint';

function getModuleId(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/\/src\/modules\/([^/]+)(?:\/([^/]+))?\//);
  if (!match) return null;
  if (match[1] === 'iot' && match[2]) {
    return `iot/${match[2]}`;
  }
  return match[1];
}

const noCrossModuleImportsPlugin = {
  rules: {
    'no-cross-module-imports': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow importing one module from another module under src/modules/',
        },
        schema: [],
      },
      create(context) {
        const filename = context.filename || context.getFilename();
        const currentModule = getModuleId(filename);
        if (!currentModule) return {};

        function checkSource(node, sourceValue) {
          if (typeof sourceValue !== 'string') return;
          let targetNormalized = sourceValue.replace(/\\/g, '/');
          if (sourceValue.startsWith('.')) {
            targetNormalized = path
              .resolve(path.dirname(filename), sourceValue)
              .replace(/\\/g, '/');
          } else {
            const idx = targetNormalized.indexOf('modules/');
            if (idx !== -1) {
              targetNormalized = '/src/' + targetNormalized.slice(idx);
            }
          }
          // Append trailing slash so a barrel import like ".../modules/vault" matches
          const targetModule = getModuleId(targetNormalized + '/');
          if (targetModule && targetModule !== currentModule) {
            context.report({
              node,
              message: `Module "${currentModule}" must not import from module "${targetModule}". Use core/ events instead.`,
            });
          }
        }

        return {
          ImportDeclaration(node) {
            checkSource(node.source, node.source.value);
          },
          ExportNamedDeclaration(node) {
            if (node.source) checkSource(node.source, node.source.value);
          },
          ExportAllDeclaration(node) {
            if (node.source) checkSource(node.source, node.source.value);
          },
          ImportExpression(node) {
            if (node.source?.type === 'Literal') {
              checkSource(node.source, node.source.value);
            }
          },
        };
      },
    },
  },
};

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    plugins: {
      local: noCrossModuleImportsPlugin,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      'local/no-cross-module-imports': 'error',
    },
  }
);
