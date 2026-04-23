# Resilient Planner

生活スケジュールと ToDo をもとに、崩れにくい明日の計画を作る単一ユーザー向け PWA です。

## 構成

- FastAPI サーバー
- OpenAI API はサーバー側からのみ呼び出し
- 単一ユーザーのログイン制御
- 署名付き HttpOnly セッションクッキー
- CSRF ヘッダー検証つき API
- Web App Manifest + Service Worker による PWA 対応

## この構成が安全で作りやすい理由

- API キーをブラウザやスマホアプリ側に置かない
- 公開してもログインしない限りアプリ本体に入れない
- Android では HTTPS 公開後にインストールでき、次からはアイコン起動できる
- Python 単体で動くため、構成が増えすぎない

## 使い方

1. `.env.example` をコピーして `.env` を作る
2. `.env` に少なくとも次を設定する

```env
OPENAI_API_KEY=your_api_key_here
APP_SECRET_KEY=replace_with_a_long_random_secret
INITIAL_ADMIN_USERNAME=owner
INITIAL_ADMIN_PASSWORD=replace_with_a_strong_password
```

3. 必要なら `OPENAI_MODEL` を変更する
4. ローカル起動

```powershell
python server.py
```

5. [http://127.0.0.1:8000](http://127.0.0.1:8000) を開いてログイン

## スマホ単体で使うには

1. このアプリを HTTPS で公開する
2. `PUBLIC_APP_URL` を公開 URL に設定する
3. `COOKIE_SECURE=true` を使う
4. Android Chrome で公開 URL を一度開いてインストールする
5. 以後はホーム画面やアプリ一覧のアイコンから起動する

## 注意

- 初回管理ユーザーは `INITIAL_ADMIN_USERNAME` と `INITIAL_ADMIN_PASSWORD` から自動作成されます
- OpenAI API キーは絶対にフロントエンドへ置かないでください
- 本番公開では HTTPS を必須にしてください

## いちばん簡単な公開方法

Render を使うのがいちばん簡単です。

1. このフォルダを GitHub に push する
2. Render でその GitHub リポジトリを Web Service として作成する
3. `render.yaml` を使うか、手動で次を設定する

```text
Build Command: pip install -r requirements.txt
Start Command: python server.py
```

4. Render 側の環境変数に次を設定する

```text
OPENAI_API_KEY
INITIAL_ADMIN_USERNAME
INITIAL_ADMIN_PASSWORD
APP_SECRET_KEY
COOKIE_SECURE=true
```

5. デプロイ後に発行される HTTPS の URL を `PUBLIC_APP_URL` に設定する
6. Android Chrome でその URL を開き、インストールする
