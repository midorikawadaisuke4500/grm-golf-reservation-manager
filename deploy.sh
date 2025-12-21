#!/bin/bash
# GRM デプロイスクリプト
# 使い方: ./deploy.sh "コミットメッセージ"

cd "$(dirname "$0")"

MESSAGE="${1:-自動コミット}"

echo "=========================================="
echo "  GRM デプロイ開始"
echo "=========================================="

# Step 1: Git コミット & プッシュ
echo ""
echo "📦 Step 1: GitHubにバックアップ..."
git add .
git commit -m "$MESSAGE"
git push

# Step 2: clasp push
echo ""
echo "🚀 Step 2: GASにデプロイ..."
clasp push --force

echo ""
echo "=========================================="
echo "  ✅ デプロイ完了"
echo "=========================================="
echo ""
echo "📋 次のステップ:"
echo "  1. GASエディタで確認"
echo "  2. 必要に応じて再デプロイ（新バージョン）"
