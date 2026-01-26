# 🌀 UZU Roaster
**USBシリアル通信 ✕ Web技術で実現する、次世代の小型焙煎機コントローラー**
うずうずコーヒー焙煎工房の自動焙煎プロジェクト

!

## 🌟 これは何？
`UZU Roaster` は、ESP32ベースの自作コーヒー焙煎機「UZU」のデータをPCで可視化・制御するためのデスクトップアプリです。
Pythonでシリアル通信を制御し、UIにはモダンなWeb技術（HTML5/JS/CSS）を採用することで、軽量かつ直感的な操作感を実現しました。

## ✨ 特徴
- **リアルタイム・グラフ**: 豆温度(BT)や環境温度(ET)を1秒単位で可視化。
- **簡単接続**: ポート自動検出機能により、接続して起動するだけでUZUを認識。
- **データ保存/読込**: 焙煎記録をJSON形式で保存。過去のプロファイルとの比較も可能。
- **一本のexeで動作**: Pythonのインストール不要。ダブルクリックですぐに焙煎開始！
- **Artisan連携**: 内部的にArtisanプロトコルをサポートし、既存ツールとの共存も可能。

## 🚀 クイックスタート (Windows版)
1. [Releases] `uzuroaster.exe` をダウンロードします。
2. UZU本体をUSBでPCに接続します。（CH340 USB Serialドライバが必要です）
3. `uzuroaster.exe` をダブルクリックして起動します。
   - ※初回起動時にWindowsの警告が出る場合がありますが、「詳細情報」→「実行」を選択してください。
4. 画面上の「Connect」または「START」ボタンを押して、焙煎を開始してください。

## 🛠 開発者向け (Pythonで実行する場合)
自分でコードをカスタマイズしたいギークな方はこちら。

### 依存ライブラリのインストール
```bash
pip install pywebview pyserial
実行
Bash

python uzuroaster.py
📦 ビルド (exe化)
PyInstallerを使用して、自分でexeを作成する場合：

Bash

python -m PyInstaller --noconsole --onefile --hidden-import=webview --add-data "index.html;." uzuroaster.py
📖 オンラインマニュアル
詳しい使い方やハードウェアの仕様については、以下のマニュアルを参照してください。 UZU Roaster オンラインマニュアル

🤝 コントリビュート
バグ報告や機能要望は Issue または Pull Request までお気軽にどうぞ！ コーヒー片手に楽しく開発しています。☕️

Developed by [Yoshihiko Ida/ UzuuzuHonpo] Roasting the future with Code and Beans.