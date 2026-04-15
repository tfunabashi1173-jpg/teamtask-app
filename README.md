# Team Task App

Expo ベースの React Native 版です。既存の Web / PWA バックエンドと同じ Supabase / API を使いながら、ネイティブアプリとして実装を進めます。

## backend-copy について

`backend-copy/` に、既存 PWA で使用している API / 認証 / 通知 / SQL をコピー保存しています。
これは参照用の複製であり、元の PWA ファイルは削除しません。

## 初回セットアップ

1. `.env.example` を `.env.local` にコピー
2. 以下を設定
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - `EXPO_PUBLIC_WEB_APP_URL`
3. 依存関係をインストール
4. 起動

```bash
npm install
npm run start
```

## 現在の実装

- LINE ログイン導線
- セッショントークンの端末保存
- 当日タスク一覧
- タスク詳細モーダル
- 開始 / 確認待ち / 完了 / 中断 / 翌日 の状態変更
- タスク追加
- 既存タスクのコピー
- 日付 / 時刻 / 優先度 / 繰り返し設定つき登録

## 今後の優先実装

1. タスク編集と削除
2. 説明用画像 2 枚の添付
3. 完了写真 3 枚の登録とプレビュー
4. Push 通知
5. 管理者向け機能
