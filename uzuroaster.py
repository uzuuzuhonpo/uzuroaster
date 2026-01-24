import webview
import serial
import threading
import time
import json
import serial.tools.list_ports

# --- 設定 ---
SERIAL_PORT = 'COM4'  # 部長のUZUが繋がってるポートに書き換えてな！
BAUD_RATE = 115200

def serial_handler(window):
    ser = None
    
    # --- ポート自動検出ロジック ---
    def find_uzu_port():
        ports = serial.tools.list_ports.comports()
        for p in ports:
            # ESP32によく使われるシリアルチップの名前を検索
            if 'CH340' in p.description or 'USB Serial' in p.description:
                print(f"Found UZU at {p.device} ({p.description})")
                return p.device
        return None

    target_port = find_uzu_port() or 'COM3' # 見つからなければCOM3を試す

    while True:
        if ser is None or not ser.is_open:
            try:
                ser = serial.Serial(target_port, 115200, timeout=0.5)
                print(f"UZU-G1 Connected to {target_port}!")
            except:
                time.sleep(2)
                continue

        try:
            ser.write(b"READ\n")
            line = ser.readline().decode('utf-8', errors='ignore').strip()
            print(line)
            if line:
                # 数字とカンマ以外が含まれてる起動ログとかを安全に弾く
                data = line.split(',')
                # 最初の方のログ対策：要素が1つでも、それが数字なら通す
                try:
                    # 豆温度（BT）はArtisan形式なら2番目、単体なら1番目
                    temp_val = float(data[1]) if len(data) >= 2 else float(data[0])
                    window.evaluate_js(f"if(window.updateFromPython){{ updateFromPython({temp_val}); }}")
                except ValueError:
                    # 数字に変換できない文字列（bootログなど）は無視して次へ
                    continue
        except Exception as e:
            print(f"Serial Error: {e}")
            ser = None # 接続が切れたら再接続へ
        time.sleep(1)

# GUI側のAPI（JSから呼ばれる）
class Api:
    def save_log(self, data):
        print("JSからデータが来たで！")
        with open("roast_history.json", "w") as f:
            json.dump(data, f)
        return "Saved!"

def start_app():
    api = Api()
    # 窓を作る
    window = webview.create_window('UZU Roaster Pro', 'index.html', js_api=api)
    
    # 窓が起動した後にシリアルループを「別スレッド」で開始
    # これでデバッグモードでもフリーズしにくくなる
    t = threading.Thread(target=serial_handler, args=(window,), daemon=True)
    t.start()
    
    # GUI起動（debug=Falseにするとより安定するけど、Trueでもこれでいけるはず）
    webview.start(debug=True)

if __name__ == '__main__':
    start_app()
