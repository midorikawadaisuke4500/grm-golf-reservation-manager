---
description: GASにデプロイする（固定URLを維持）
---
# GASデプロイワークフロー

このワークフローは、GASコードをデプロイし、APIエンドポイントURLを固定に保ちます。

## 固定デプロイメントID

```
AKfycbz7_L2rm_ECmjpDGb93HVm4lpCa4ui-2CDqlaSIqEDU3OsC-YDWfCVOnMVlcBXtUND6
```

## 固定API URL

```
https://script.google.com/macros/s/AKfycbz7_L2rm_ECmjpDGb93HVm4lpCa4ui-2CDqlaSIqEDU3OsC-YDWfCVOnMVlcBXtUND6/exec
```

## デプロイ手順

// turbo-all

1. GASにプッシュ

```bash
cd /Users/daisukemidorikawa/アンチグラビティ/スケジュールマージ機能/gas-backend
clasp push --force
```

1. 固定IDでデプロイ（URLが変わらない）

```bash
clasp deploy -i AKfycbz7_L2rm_ECmjpDGb93HVm4lpCa4ui-2CDqlaSIqEDU3OsC-YDWfCVOnMVlcBXtUND6 -d "更新"
```

1. GitHub Pagesにプッシュ（fast.htmlのAPI URLは変更不要）

```bash
cd docs && git add . && git commit -m "更新" && git push
```

## 重要事項

- **APIエンドポイントは常に同じURLを使用**
- fast.htmlのAPI定数を変更する必要はありません
- `clasp deploy -i [デプロイメントID]` で同じURLを維持しながらコード更新
