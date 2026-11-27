# 案件カードを挿入・編集するホストの実装例

[Issue #29](https://github.com/TommyKammy/Nobita/issues/29) の動作例。公開エントリだけを使った [host.js](host.js) と [HTML](index.html) を参照。

## 起動と操作

リポジトリのルートで実行する。

```sh
pnpm install --frozen-lockfile
pnpm build
python3 -m http.server 4189 --bind 127.0.0.1
```

[案件カードのサンプル](http://127.0.0.1:4189/examples/ticket-card/) を開く。

1. 本文の空段落に `/案件` と入力し、「案件カード」を選ぶ。カードと後続の空段落がその位置に追加され、段落で入力を続けられる。
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

案件番号と状態の編集だけなら、新しいペイロード更新APIは不要。カード内の一部をNobita本文と同じリッチテキストとして編集する要件は別途設計する。現在のレンダラーは非編集ウィジェットを返す契約で、通常の段落を子に置けば既存の編集機能を利用できる。ウィジェット内部に編集領域を置く場合は、選択位置、IME、クリップボード、Undoと文書モデルの対応を定義する必要がある。
