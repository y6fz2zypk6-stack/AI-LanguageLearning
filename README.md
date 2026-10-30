# AI-LanguageLearning（Language Partner）

AIが相手の言語交換チャットPWA。会話しながら、自分の文の間違いをカードで直してもらう。
中国語がメインで、英語の相手も同じアプリで作れる。仕様は [docs/SPEC.md](docs/SPEC.md)。

React 19 + esbuild / Express 5 + SQLite（better-sqlite3）/ OpenRouter。構成は aI-chatv2 にそろえてある。

## できること

- 相手（パートナー）を作る: 名前・言語・レベル（HSK / CEFR）・性別・年齢・出身・職業・性格・趣味
- チャット: 相手の返事＋日本語訳（吹き出しをタップで開く）、相手から話しかけてもらうこともできる
- 矯正カード: 自分の発言の下に「誤り」「より自然に」を、直した文と一言の解説つきで出す
- 間違いログ: 矯正を自動でためる。未復習・種類・相手で絞り込み、復習済みにできる
- ピンイン（中国語）: 常に出す / タップで出す / 出さない。声調の色分け
- 読み上げ: 端末の音声で相手の返事と直した文を読む
- 記憶: 会話で分かったあなたのことを、決まった往復数ごとに書き直してプロンプトに入れる（画面から手で直せる）

## セットアップ

```bash
npm install
cp .env.example .env   # OPENROUTER_API_KEY と APP_PASSWORD を設定
npm run build
npm start              # http://localhost:3002
```

`.env` は**リポジトリルート**に置く（`server/.env` は読まれない）。`DB_PATH` の相対パスもルート基準。

### 開発

```bash
npm run dev            # サーバー（tsx watch）とクライアント（esbuild --watch）を同時に起動
# http://localhost:3002 を開く（サーバーが client/dist を配信する）
```

### テスト

```bash
npm test
```

OpenRouter互換のモックを立て、実際のAPIを叩いて確かめる（`OPENROUTER_API_KEY` は不要、一時DBを使う）。
返事・矯正・間違いログの保存、形式崩れの再試行、上流の失敗時に何も残さないこと、記憶の書き直し、
ログイン、パスワード無しで外に出す構成を起動させないこと、など。

## VPS（aI-chatv2・Novel と同じサーバーに置く）

いまのサーバーの割り当てと、このアプリの置き場所:

| アプリ | 待ち受け | tailscale serve |
|---|---|---|
| Novel | 3000 | 10000 |
| aI-chatv2 | 3001 | 8443 |
| **このアプリ** | **3002** | **443**（URLにポート番号が付かない） |

アプリは `127.0.0.1` だけで待ち受け、`tailscale serve` が tailnet の中にだけ HTTPS で出す。
**VPSの公開ポート（ufw）は何も開けなくてよい**（22番だけのままでOK）。

```bash
# 0. 空きを確かめる（:3002 と :443 が一覧に無ければ空き）
sudo ss -tlnp | grep -E ':300[0-9]'
sudo tailscale serve status

# 1. 取ってきて設定する
git clone https://github.com/y6fz2zypk6-stack/AI-LanguageLearning.git
cd AI-LanguageLearning
npm install
cp .env.example .env
nano .env               # 下の3つを設定する（BIND は行頭の # を消す）
npm test                # モックで通しテスト（APIキー不要）
npm run build
```

`.env` で最初に設定するもの:

```
OPENROUTER_API_KEY=sk-or-...
APP_PASSWORD=<好きなパスワード>
BIND=127.0.0.1
```

`APP_PASSWORD` と `BIND` が両方とも無いと、サーバーは「起動を中止しました」と出して止まる（安全装置）。
VPSは公開ポートが22番だけなので、最初から `BIND=127.0.0.1` にしてよい（`tailscale serve` は 127.0.0.1 へ転送するので、これで届く）。

```bash
# 2. 起動して、VPSの中から確かめる
npm start
curl -sI http://127.0.0.1:3002 | head -1    # 別のSSHで。HTTP/1.1 200 OK ならOK

# 3. tailnet 内の HTTPS で受ける（443番。既存の 8443・10000 には触らない）
sudo tailscale serve --bg 3002
# 別の端末から https://<マシン名>.<tailnet>.ts.net で開けることを確認する
```

開けたら `.env` に次を足して再起動する（ログインのCookieをHTTPS用にするため）。

```
APP_URL=https://<マシン名>.<tailnet>.ts.net
TRUST_PROXY=1
```

- 443 が使用中だったら、空いている別の番号で `sudo tailscale serve --bg --https=<番号> 3002` にして、`APP_URL` にもその番号を付ける
- ポートが違えば別のオリジンになるので、Service Worker・キャッシュ・ホーム画面のアプリは他の2つと混ざらない
- **Cookieだけはポートで分かれない**ので、セッションCookieの名前を aI-chatv2 の `sid` と分けて `lp_sid` にしてある（同じ名前だと、片方にログインするたびにもう片方がログアウトされる）
- 常駐のさせ方（pm2・systemd など）は aI-chatv2 と同じでよい。iPhone では Safari で開いて「共有 → ホーム画面に追加」

**パスワードも `BIND` も無いまま外に出す構成では、サーバーは起動しない**（aI-chatv2 と同じ安全装置）。

### 更新

```bash
git pull
npm install
npm run build
# サーバーを再起動
```

### バックアップ

DBは `data/app.sqlite` の1ファイル。コピーするときはサーバーを止めて、`app.sqlite-wal` / `app.sqlite-shm` も一緒に扱う。

## 環境変数

| キー | 説明 |
|---|---|
| `OPENROUTER_API_KEY` | 必須。サーバーだけが持ち、ブラウザには渡さない |
| `APP_PASSWORD` | 公開VPSでは必須。単一パスワード + httpOnly Cookie |
| `SESSION_SECRET` | パスワード比較のHMAC鍵。未設定なら `APP_PASSWORD` を代用 |
| `DEFAULT_MODEL` | 会話用の既定モデル（既定 `~anthropic/claude-sonnet-latest`）。画面の設定が優先 |
| `UTILITY_MODEL` | 記憶の書き直し用。空なら会話用と同じ |
| `PORT` / `BIND` | 既定 3002 / 全インターフェース。Tailscale の背後なら `BIND=127.0.0.1` |
| `APP_URL` / `COOKIE_SECURE` / `TRUST_PROXY` | HTTPS運用の設定（aI-chatv2 と同じ意味） |
| `DB_PATH` / `APP_TITLE` | 任意 |
| `LLM_TIMEOUT_MS` | 1回の生成の待ち時間の上限（既定 90000） |

## 構成

```
shared/types.ts        API境界の共有型
server/src/
  db/                  schema.sql / マイグレーション（PRAGMA user_version）/ テーブルごとの関数
  domain/chat.ts       送信 → 生成 → 保存（返事・矯正・間違いログを1トランザクションで）
  domain/memory.ts     記憶の書き直し
  llm/                 openrouter（呼び出し）/ prompt（システムプロンプト）/ parse（JSONの読み取り）
  routes/              API
server/test/           モックLLM・単体テスト・結合テスト
client/src/
  pages/               画面（相手一覧・チャット・相手の設定・間違いログ・設定）
  pinyin.ts            ピンイン（pinyin-pro を中国語の画面でだけ読み込む）
  tts.ts               読み上げ（Web Speech API）
client/scripts/build.mjs  esbuild でのビルドと sw.js の生成
```

### aI-chatv2 との違い

- クライアントのビルドは Vite ではなく **esbuild**（`client/scripts/build.mjs`）。依存が少なく、開発時もサーバーが `client/dist` を配信するだけで済む
- サーバーは tsc でビルドせず **tsx で直接起動**する。型チェックは `npm run typecheck` で別に行う
- ルーターと状態管理は自前の小さな実装（画面が5つだけなので react-router / zustand は使わない）
- 返事はJSONで受け取るので、ストリーミングはしない
