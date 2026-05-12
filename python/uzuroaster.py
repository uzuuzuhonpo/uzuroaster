import webview
import serial
import threading
import time
import json
import serial.tools.list_ports
import tkinter as tk
from tkinter import filedialog
import sys

# --- 設定 ---
SERIAL_PORT = 'COM4'  # 部長のUZUが繋がってるポートに書き換えてな！
BAUD_RATE = 115200

#######################################################
class Api:
    def __init__(self):
        self.ser = None # 最初は空。後でここに本物のシリアルを入れる

    def send_command(self, cmd):
        # JSから呼ばれた時、カバンの中の ser を使って書き込む
        if self.ser and self.ser.is_open:
            self.ser.write(f"{cmd}\n".encode())
            print(f"Python: {cmd} を送信")

    def save_file(self, data):
            """JSから送られてきた焙煎データ（JSON）を保存する"""
            root = tk.Tk()
            root.withdraw() # 変なウィンドウが出ないように隠す
            root.attributes('-topmost', True) # ダイアログを最前面に
            
            file_path = filedialog.asksaveasfilename(
                defaultextension=".json",
                filetypes=[("JSON files", "*.json"), ("All files", "*.*")],
                title="焙煎データ保存"
            )
            root.destroy()

            if file_path:
                with open(file_path, 'w', encoding='utf-8') as f:
                    f.write(data)  
                print(f"✅ 保存完了: {file_path}")
                return True
            return False

    def load_file(self):
        """保存されたJSONを読み込んでJSに返す"""
        root = tk.Tk()
        root.withdraw()
        root.attributes('-topmost', True)

        file_types = [
                ("Roast Log files", "*.csv *.alog *.json"), # まとめて表示
                ("JSON files", "*.json"),
                ("CSV files", "*.csv"),
                ("Artisan files", "*.alog"),
                ("All files", "*.*")
        ]        
        file_path = filedialog.askopenfilename(
            filetypes=file_types,
            title="焙煎データ読込"
        )
        root.destroy()

        if file_path:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                return {"type": "text", "content": f.read(), "path": file_path}

        return None

    def close_serial(self):
        """終了時に呼ばれる後片付け"""
        if self.ser and self.ser.is_open:
            try:
                # USBSerialに off コマンド送信
                self.ser.write(b"stop\n") 
                self.ser.write(b'usbserial off\n')
                time.sleep(0.5)
            except Exception as e:
                print(f"⚠️ 終了処理中にエラー: {e}")
                    
#######################################################
def serial_handler(window, api):
    ser = None
    
    # --- ポート自動検出ロジック ---
    def find_uzu_port():
        ports = serial.tools.list_ports.comports()
        for p in ports:
            # ESP32によく使われるシリアルチップの名前を検索
            if 'CH340' in p.description or 'CH34x' in p.description or 'USB Serial' in p.description:
                print(f"Found UZU ROASTER at {p.device} ({p.description})")
                return p.device
        return None

    while True:
        while True:
            window.evaluate_js(f"if(window.pythonSerialDisConnected){{ pythonSerialDisConnected(''); }}")

            try:
                target_port = find_uzu_port() or 'COM3' # 見つからなければCOM3を試す
                ser = serial.Serial(target_port, 115200, timeout=0.5)
                ser.write(b"usbserial on\n") 
                break          
            except:
                time.sleep(2)
                continue
        api.ser = ser
        while True:
            if ser is not None or not ser.is_open:
                try:
                    line = ser.readline().decode('utf-8', errors='ignore').strip()
                    if line:
                        try:
                            if line.startswith('{') and line.endswith('}'):
                                # JSONっぽい形をしてる時だけ、JSに送る
                                window.evaluate_js(f"if(window.updateFromPython){{ updateFromPython('{line}'); }}")
                            else:
                                # それ以外のログ（"USB Serial..."とか）はPythonのコンソールに出すだけにする
                                print(f"UZU Log (Skip JS): {line}")
                        except ValueError:
                            # 数字に変換できない文字列（bootログなど）は無視して次へ
                            continue
                except Exception as e:
                    print(f"Serial Error: {e}")
                    ser = None # 接続が切れたら再接続へ
                    break
        
#######################################################
def start_app():
    api = Api()
    # 窓を作る
    window = webview.create_window('UZU ROASTER Controller for Python', 'index.html', width=1280, height=800, maximized=True, js_api=api)
    # ウィンドウが閉じられたときに close_serial を呼ぶように設定
    window.events.closed += api.close_serial  

    # 窓が起動した後にシリアルループを「別スレッド」で開始
    # これでデバッグモードでもフリーズしにくくなる
    t = threading.Thread(target=serial_handler, args=(window, api), daemon=True)
    t.start()
    
    # GUI起動
    if (sys.argv[1:] and sys.argv[1] == '--debug'):
        debugging = True
    else:  
        debugging = False
    webview.start(debug=debugging) 

if __name__ == '__main__':
    start_app()
