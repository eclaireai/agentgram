#!/bin/bash
set -e

echo "🚀 agentgram publish script"
echo ""

# Check npm login
if ! npm whoami &>/dev/null; then
  echo "❌ Not logged in to npm. Running npm login..."
  npm login
fi

echo "✅ Logged in as: $(npm whoami)"
echo ""

# Run full CI
echo "Running CI checks..."
npm run ci
echo ""

# Publish
echo "Publishing to npm..."
npm publish --access public
echo ""

echo "✅ Published! https://www.npmjs.com/package/agentgram"
echo ""
echo "Next steps:"
echo "  1. gh auth refresh -h github.com -s workflow"
echo "  2. git add .github/workflows/ && git commit -m 'ci: add workflows' && git push"
echo "  3. Post Show HN (see SHOW_HN.md)"
