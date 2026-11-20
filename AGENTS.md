# youtube-lyric-search

YouTube 再生中の楽曲から歌詞を検索するブラウザ拡張。Vite + TypeScript。

## 構成

- `src/content/` — YouTube ページに注入するコンテンツスクリプト
- `src/lib/` — タイトル解析・歌詞検索・クエリ上書き
- `tests/` — vitest

## 現在のブランチ状態

`feature/panel-collapse-and-metadata-accuracy` が `main` より 9 コミット先行している
(18 files, +1368/-113)。パネル折りたたみとメタデータ精度の改善が入っている。
**merge するか継続するかが未決**。作業前に方針を確認すること。

## 検証

```
npm test
npx tsc --noEmit
```
