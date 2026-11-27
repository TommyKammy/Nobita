# 案件カードを挿入・編集するホストの実装例

ホストが `registerCustomBlock` で案件カードのフォームを登録し、`registerSlashBlock` で本文のスラッシュメニューに「案件カード」を追加する例です。[ホストコード](host.js) · [フォームのHTML](index.html) · [公開API](../../docs/public-api.md#host-defined-blocks)

## 起動と操作

リポジトリのルートで実行する。

```sh
pnpm install --frozen-lockfile
pnpm build
python3 -m http.server 4189 --bind 127.0.0.1
```

[案件カードのサンプル](http://127.0.0.1:4189/examples/ticket-card/) を開く。

1. 子ブロックのない空段落に `/案件` または `/ticket` と入力し、「案件カード」を選ぶ。カードは元の段落の直前に挿入される。元の段落は空になり、そのまま本文を入力できる。挿入直後に「元に戻す」を押すと、入力前の空段落に戻る。
2. カードの案件番号と状態を変更して「変更を確定」を押す。確定前はフォーム内の下書き。確定すると1回の文書更新になり、「元に戻す」「やり直す」で両項目をまとめて戻せる。
3. ページを再読込する。文書更新時に保存したNobita JSONからカードが復元される。
4. 「未登録クライアント」を開くとカードには型名が表示される。隣の段落を編集して通常表示に戻り、案件番号と状態が残ることを確認できる。「読み取り専用」ではカードの入力と確定を無効にする。

保存先はこのオリジンのサンプル専用localStorageキー。同じ文書を複数タブから同時編集する場合の競合解決は対象外。

## 現行APIでできること

| 操作 | ホスト側の実装 |
| --- | --- |
| 登録・表示 | エディター単位の `registerCustomBlock(type, renderTicket)`。レンダラーは現在のブロックと読み取り専用フラグを受け取り、ネイティブのフォームを返す。 |
| 生成・挿入 | `createBlock` で型・JSONペイロード・テキスト表現を作る。`registerSlashBlock` で標準メニューに登録する。 |
| 編集・履歴 | フォーム確定時に `updateBlock` で最新のブロックをIDから更新し、既存の追加フィールドと子ブロックを保持。再描画はエディターに任せる。未知のペイロード版では入力フォームを表示しない。 |
| 保存・復元 | `onChange` と `docToJSON` で保存し、初期化時の `doc` にJSON文字列を渡す。未登録クライアントにも `custom:` 型を認識する版のNobitaが必要。 |

## 標準スラッシュメニューへの登録

```js
editor.registerCustomBlock('custom:ticket', renderTicket);
const unregister = editor.registerSlashBlock({
  id: 'acme.insert-ticket',
  label: '案件カード',
  keywords: ['案件', 'ticket'],
  create: createTicket,
});
// ホストがこの機能を取り外すとき
// unregister();
```

候補を選ぶと `createTicket` が呼ばれ、新しいIDを持つ `custom:ticket` ブロックが生成される。`acme.insert-ticket` はこのエディター内のコマンドIDで、`unregister()` はその登録を解除する。保存済みのカードは引き続き `custom:ticket` のレンダラーで表示される。

案件番号と状態の編集にはネイティブのフォームを使う。カードにNobitaのリッチテキスト編集を組み合わせる場合は、通常の段落を子ブロックにできる。ウィジェット内部の選択・IME・クリップボードを文書モデルに結び付ける方法は別の設計課題となる。[設計の背景（Issue #29）](https://github.com/TommyKammy/Nobita/issues/29)
