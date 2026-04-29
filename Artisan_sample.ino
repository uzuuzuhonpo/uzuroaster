#define WEBSOCKETS_SERVER_CLIENT_MAX 16  // デフォルト4　ゾンビ対策で保険として
#define MAX_ROAST_TIME  1800
#define MAX_TEMPERATURE 1000  // 260
#define MIN_TEMPERATURE -20
#define MAX_WIFI_CONNECTION   1 //10  //デフォルト。複数繋げると切断時にWebSocketゴースト？が残って処理が重くなるため当面1個だけ接続許可(温度を送信するところをコメントアウトで問題なく動く)
#define ELEGANTOTA_USE_ASYNC_WEBSERVER 1 // OTAアップデート用(実際はElegantoTA.hのdefineを書き換える必要あり)

#define IP_LED_OFF 0
#define IP_LED_AP  1
#define IP_LED_STA 2

#include <WiFi.h>
//#include <ElegantOTA.h>
#include <ESP32Servo.h>  
#include <LittleFS.h>
#include <ESPAsyncWebServer.h>
#include <WebSocketsServer.h>
#include <DNSServer.h>
#include "Adafruit_MAX31855.h"
#include "esp_pm.h"
#include <Preferences.h> 
//#include <WebSerial.h>
#include <ArduinoJson.h>
//#include "Freenove_WS2812_Lib_for_ESP32.h"
#include <Update.h>
#include "esp_ota_ops.h"

// Prototype
void CommandProcess(String& command, const uint8_t* params = NULL);
void BroadcastMessage(String &message);

//////////////////////////////////////////////////////////////////////////
// Global Variables
//////////////////////////////////////////////////////////////////////////
//■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
const String version = "1.3.0";
const String CodeName ="Antigua";
//■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
TaskHandle_t taskHandle;
AsyncWebServer ServerObject(80);
WebSocketsServer webSocket = WebSocketsServer(81);
Servo myservo;
DNSServer dnsServer;   // キャプティブポータル用 DNS
Preferences preferences;  

const char* updateIndex = R"rawliteral(
<!DOCTYPE html>
<html lang='ja'>
<head>
  <meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1'>
  <title>UZU SYSTEM LOADER</title>
  <style>
    body {background:#000;color:#fff;font-family:monospace;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;}
    .container{width:85%; max-width:400px; border:1px solid #333; padding:20px 20px; text-align:center;}
	.interpret{width:90%; text-align:left;line-height:1.4rem;margin:2rem auto;}
    h2{font-size:1rem; letter-spacing:0.2rem; margin-bottom:10px;color:#aaa;}
a:link{color:#3182ce;}
a:visited{color:#805ad5;}
a:hover{color:#2b6cb0;}
a:active{color:#e53e3e;}
    #mode-label{font-size:0.75rem; color:#555; margin-bottom:20px; letter-spacing:0.15rem; min-height:1rem;}
    #mode-firmware{color:#ff6b35;}
    #mode-fs{color:#00aaff;}
    input[type=file]{color:#888; margin-bottom:30px; font-size:0.8rem;width:100%;}
    #btn-submit{background:none;color:#fff;border:1px solid #fff;padding:10px 40px;cursor:pointer;font-family:monospace;transition:0.2s;}
    #btn-submit:hover{background:#fff;color:#000;}
    #prg-wrapper{display:none;}
    .bar-frame{border:1px solid #444; height:10px;margin:20px 0;position:relative;}
    .bar-fill{background:#fff; width:0%; height:100%;transition:width 0.1s;}
    #status{font-size:0.8rem; color:#888; text-transform:uppercase;}
    .success{color:#00ff00!important;}
  </style>
</head>
<body>
  <div class='container'>
    <h2 id='title'>UZU_SYSTEM_UPDATE</h2>
  <div class="interpret">
      <strong><u>注意事項</u></strong><br>
      • この機能はPCブラウザでのみご利用ください<br>
      • ファイルアップロード後、UZU ROASTERを再起動し、再接続してください<br>
      • アップロード中は電源を切らないでください
  </div>
  <div class="interpret">
      <strong><u>ファイルの入手方法:</u></strong><br>
      1. <a href='https://github.com/uzuuzuhonpo/uzuroaster' target='_blank'>GitHub</a>から最新版をダウンロード<br>
		・ファームウェア： Artisan_sample.ino.bin<br>
		・うずロースターコントローラー： index.html<br>
      2. PCの任意のフォルダに保存<br>
      3. 下記のフォームでファイルを選択してアップロード<br>
      <p style="margin-top:20px;"><strong>※バージョンアップは上記2種類のファイルをアップロードしてください（アップロード操作を2回行う必要があります）</strong></p>
  </div>
    <div id='mode-label'>SELECT FILE TO DETECT MODE</div>
    <form id='upload-form' method='POST' action='/update' enctype='multipart/form-data'>
      <input type='file' name='update' id='file-input' accept='.bin,.html,.js,.css,.png,.jpg,.json,.txt,.alog,.csv'>
      <br>
      <input type='submit' id='btn-submit' value='実行'>
    </form>
    <div id='prg-wrapper'>
      <div class='bar-frame'><div id='bar' class='bar-fill'></div></div>
      <div id='status'>LOADING: <span id='pct'>0</span>%</div>
    </div>
  <p style="margin-top:30px;"><a href="/">← メイン画面に戻る</a></p>
  </div>
  <script>
    // ファイル選択時にモード表示を更新
    document.getElementById('file-input').addEventListener('change', function() {
      const file = this.files[0];
      const label = document.getElementById('mode-label');
      if (!file) {
        label.innerHTML = 'SELECT FILE TO DETECT MODE';
        label.className = '';
        return;
      }
      const isBin = file.name.toLowerCase().endsWith('.bin');
      if (isBin) {
        label.innerHTML = '<span id="mode-firmware">[ FIRMWARE UPDATE MODE ]</span>';
      } else {
        label.innerHTML = '<span id="mode-fs">[ LITTLEFS FILE MODE ]</span>';
      }
    });

    const form = document.getElementById('upload-form');
    form.onsubmit = () => {
      const file = document.getElementById('file-input').files[0];
      if(!file) return false;
      form.style.display = 'none';
      document.getElementById('prg-wrapper').style.display = 'block';
      const isBin = file.name.toLowerCase().endsWith('.bin');
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const p = Math.round((e.loaded / e.total) * 100);
          document.getElementById('bar').style.width = p + '%';
          document.getElementById('pct').innerHTML = p;
          if (p >= 100) {
            document.getElementById('status').innerHTML = 'FLASHING... PLEASE WAIT';
            document.getElementById('status').innerHTML = '<span class="success">UPDATE COMPLETED</span>';
            // binの場合はリブート、LittleFSの場合はリブートなし
            if (isBin) {
              document.getElementById('title').innerHTML = 'REBOOTING...';
              setTimeout(() => { window.location.href = "/update"; }, 3000);
            } else {
              document.getElementById('title').innerHTML = 'FILE UPLOADED';
              setTimeout(() => { window.location.href = "/update"; }, 2000);
            }
          }
        }
      });
      xhr.onreadystatechange = () => {
        if (xhr.readyState === 4 && xhr.status !== 200 && xhr.status !== 0) {
          document.getElementById('status').innerHTML = 'ERROR: UPDATE FAILED (' + xhr.status + ')';
        }
      };
      xhr.open('POST', '/update', true);
      xhr.send(new FormData(form));
      return false;
    };
  </script>
</body>
</html>
)rawliteral";

// MAX31855とつなぐピン番号
const int ThermoDO_pin = 19;   // SO
const int ThermoCS_pin = 5;    // CS
const int ThermoCLK_pin = 18;  // SCK
const int ServoPWM_pin = 14;
const int SerialBaudRate = 115200;
const int bootButtonPin = 0;  // BOOTボタンはGPIO0
std::vector<std::pair<double, double>> roastProfile;

double lastValidTemp = 20.0; // 前回の正常値を保存
int tempErrorCount = 0;
const double DEVIATION_TEMP = 10.0;

int TemperatureInterval = 500; // [ms]
int TemperatureDigit = 1; // 小数桁
String Prefix = "";
String Suffix = "";
double SimulateCount = 0.0;
bool TempDisplay = true;
bool webSocketConnected = false;  // 2026.2.20
bool wifiConnected = false;
unsigned long lastSendTime = 0;
bool roasting = false;
int roastTime = 0;
int counterx = 0;
double RoastData[MAX_ROAST_TIME];
const int DefaultAPIPAddress0 = 192;
const int DefaultAPIPAddress1 = 168;
const int DefaultAPIPAddress2 = 4;
const int DefaultAPIPAddress3 = 1;
int IPAddressMemory[4] = { DefaultAPIPAddress0, DefaultAPIPAddress1, DefaultAPIPAddress2, DefaultAPIPAddress3 };  // デフォルトのUZU ROASTER IPアドレス
// 🔑 Wi-Fi設定
const String Ssid = "UZU-ROASTER";  // デフォルト
const String Password = ""; // デフォルト
IPAddress IpAddress_; 	// 後で設定可能
const IPAddress SubNet(255, 255, 255, 0); 	
bool UsbSerial = false;
bool LEDTemperatureDisplay = false;
int LEDIPDisplay = IP_LED_OFF;  // IPアドレスをLEDで表示するモード

const String StaSsid = "";  // デフォルト
const String StaPass = "";  // デフォルト
String CurrentStaSsid = "";  // 現在の有効なSTA用SSID
String CurrentStaPassword = "";  // 現在の有効なSTA用Password

// センサーオブジェクト作成
Adafruit_MAX31855 thermocouple(ThermoCLK_pin, ThermoCS_pin, ThermoDO_pin);
double AverageTemperature = 0.0;
double RawTemperature = 0.0;  // No calibration(offset)
const String TemperaturePath = "temperature";
double TempOffset = 0.0;
double TempGain = 1.0;

// オプションボタン登録関係
int LongButtonTimerCount = 0;
String ButtonCommands[5], LongButtonCommands[5];
int ButtonCommandCount = 0, ButtonIndex = 0;
int LongButtonCommandCount = 0, LongButtonIndex = 0;

// RGB LED(Freenove)
#define LEDS_COUNT  1   // The number of led
#define LEDS_PIN	  16  // define the pin connected to the led strip
#define CHANNEL		  0   // RMT module channel
//Freenove_ESP32_WS2812 strip = Freenove_ESP32_WS2812(LEDS_COUNT, LEDS_PIN, CHANNEL, TYPE_GRB);

//////////////////////////////////////////////////////////////////////////
#define CONSOLE_NONE 0
#define CONSOLE_WEB 1
#define CONSOLE_USB 2

class SerialWrapper {
private:
  int whereTo;
  
public:
  SerialWrapper() : whereTo(CONSOLE_USB) {}
    
  void setWhereFrom(int type) {
    whereTo = type;
  }
  
template<typename T>
  void print(T value) {
    if (whereTo == CONSOLE_USB) {
      Serial.print(value);
    } else {
      // どんな型が来ても String にキャストして送るのが安全や
      String msg = String(value);
      BroadcastMessage(msg);
    }
  }

  // 小数点桁数指定付きの print
  template<typename T>
  void print(T value, int digits) {
    if (whereTo == CONSOLE_USB) {
      Serial.print(value, digits);
    } else {
      String msg = String(value, digits);
      BroadcastMessage(msg);
    }
  }

  // --- println系 ---
  // 引数なし（改行のみ）
  void println() {
    if (whereTo == CONSOLE_USB) {
      Serial.println();
    } else {
      String nl = "\n";
      BroadcastMessage(nl);
    }
  }

  // 引数ありの println
  template<typename T>
  void println(T value) {
    if (whereTo == CONSOLE_USB) {
      Serial.println(value);
    } else {
      String msg = String(value) + "\n";
      BroadcastMessage(msg);
    }
  }

  // 小数点桁数指定付きの println
  template<typename T>
  void println(T value, int digits) {
    if (whereTo == CONSOLE_USB) {
      Serial.println(value, digits);
    } else {
      String msg = String(value, digits) + "\n";
      BroadcastMessage(msg);
    }
  }
};

SerialWrapper MySerial;

//////////////////////////////////////////////////////////////////////////
class MovingAverage {
private:
    std::deque<double> window;
    int windowSize;
    int trimSize;  // 除外する最大・最小の数（両方とも）
    
public:
    // コンストラクタ：ウィンドウサイズと除外数を指定
    MovingAverage(int size, int trim) : windowSize(size), trimSize(trim) {}

    double addValue(double value) {
        window.push_back(value);

        // ウィンドウがオーバーしたら最古の値を削除
        if (window.size() > windowSize) {
            window.pop_front();
        }

        // 十分な数が集まるまで平均は計算しない
        if (window.size() < trimSize * 2 + 1) {
            return value;  // データが不足してるのでとりあえず瞬時値を出す
        }

        // ソートしてコピー
        std::vector<double> sorted(window.begin(), window.end());
        std::sort(sorted.begin(), sorted.end());

        // 最大と最小を除いた範囲で平均を取る
        double sum = 0.0;
        for (int i = trimSize; i < sorted.size() - trimSize; ++i) {
            sum += sorted[i];
        }

        int count = sorted.size() - trimSize * 2;
        return sum / count;
    }
};

//////////////////////////////////////////////////////////////////////////
//【1. タイミングとピンの設定】
#define T_ZERO 800   // 0
#define T_I 120     // 1秒単位ON期間
#define T_V 400     // 5秒単位のON期間
#define T_G 120     // OFF期間
#define T_D 500     // 桁と桁の休止期間
#define T_C 1200    // 3桁のひとくくりの休止期間
#define T_STAIP 3000    // STA IPのひとくくりの休止期間

//【3. ローマ数字テーブル】
const int romanTable[10][6] = {
{T_ZERO, 0, 0, 0, 0, 0}, // 0
{T_I, 0, 0, 0, 0, 0}, // 1
{T_I, T_I, 0, 0, 0, 0}, // 2
{T_I, T_I, T_I, 0, 0, 0}, // 3
{T_I, T_I, T_I, T_I, 0, 0}, // 4
{T_V, 0, 0, 0, 0, 0}, // 5
{T_V, T_I, 0, 0, 0, 0}, // 6
{T_V, T_I, T_I, 0, 0, 0}, // 7
{T_V, T_I, T_I, T_I, 0, 0}, // 8
{T_V, T_I, T_I, T_I, T_I, 0} // 9
};

// 3桁の数値をLEDでローマ数字点滅表示する共通関数
// brightness: LEDの明るさ（桁ごとに変えると桁の区別がしやすい）
void displayThreeDigitsOnLED(int value, int brightness = 255) {
  int dgs[3] = { (value / 100) % 10, (value / 10) % 10, value % 10 };
  for (int i = 0; i < 3; i++) {
    int bright = 0;
    switch (i) {
      case 0: bright = 255; break;  // 桁によって明るさ変える
      case 1: bright = 200; break;  
      case 2: bright = 120;  break;  
      case 3: bright = 90;  break;  
    }
    for (int p = 0; p < 6; p++) {
      int d = romanTable[dgs[i]][p];
      if (d == 0) break;
      ledcWrite_(2, bright);
      vTaskDelay(pdMS_TO_TICKS(d));
      ledcWrite_(2, 0);
      vTaskDelay(pdMS_TO_TICKS(T_G));
    }
    vTaskDelay(pdMS_TO_TICKS(T_D));  // 桁間の休止
  }
  vTaskDelay(pdMS_TO_TICKS(T_C));  // 3桁ひとくくりの休止
}

// IPアドレスの1オクテットをLEDで表示する
// オクテットは最大3桁なのでdisplayThreeDigitsOnLEDをそのまま流用
void displayIPOnLED(IPAddress ip) {
  for (int octet = 0; octet < 4; octet++) {
    displayThreeDigitsOnLED(ip[octet]);
    if (LEDIPDisplay == IP_LED_OFF) break; // モードが変わったらキャンセルしてすぐに温度表示に変更
  }
  vTaskDelay(pdMS_TO_TICKS(T_STAIP));
}

//////////////////////////////////////////////////////////////////////////
void LEDDisplayTask(void *pvParameters) {
  IPAddress ip;

  while (true) {
    if (LEDIPDisplay) {
      // IPアドレス表示モード
      if (LEDIPDisplay == IP_LED_STA) {
        ip = WiFi.localIP();  // STAのIP
      }
      else {
        ip = IPAddress(IPAddressMemory[0], IPAddressMemory[1], IPAddressMemory[2], IPAddressMemory[3]);
      }
      displayIPOnLED(ip);
    }
    else if (LEDTemperatureDisplay) {
      // 温度表示モード（既存の動作）
      displayThreeDigitsOnLED((int)AverageTemperature);
    }
    else {
      // どちらもOFFの時はタスクをスリープ
      vTaskDelay(pdMS_TO_TICKS(500));
    }
  }
}

//////////////////////////////////////////////////////////////////////////
void WiFiInstectionTask(void *pvParameters) {
  while(true) {
    // if (!wifiConnected) {
    //   webSocket.disconnect(); 
    //   webSocket.close();
    //   webSocket.begin(); 
    // }
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}

//////////////////////////////////////////////////////////////////////////
void ReadTempTask(void *pvParameters) {
  String text;
  const int CYCLE_PERIOD = 200; // 200ms
  const TickType_t delay = pdMS_TO_TICKS(CYCLE_PERIOD); 
  int ss = 1;
  int mm = 0; 
  double bt;
  enum ThermoMeterType { 
    TC4 = 0,
    Behmor,
    THERMO_MAX
  };
  ThermoMeterType thermo = Behmor;

  double avg;
  MovingAverage ma(20, 4);  // 10個の値で移動平均を計算
  int count = 0;
  int temp_send_interval_count = 0;

  while (true) {
    bt = ReadThermoCoupleWithGuard(); // ReadThermoCouple();
    avg = ma.addValue(bt);
    String msg;

    if (SimulateCount > 0.5) {
      avg = SimulateCount;
      SimulateCount += 0.1;
      if (SimulateCount > 240.0) SimulateCount = 1.0;
    }
    RawTemperature = avg; // 移動平均化処理された温度をグローバルに保存
    AverageTemperature = TempGain * RawTemperature + TempOffset; 
    if (AverageTemperature > MAX_TEMPERATURE) {AverageTemperature = MAX_TEMPERATURE;}
    else if (AverageTemperature < MIN_TEMPERATURE) {AverageTemperature = MIN_TEMPERATURE;}  // 2026.4.17 -20 minimum

    if (++count >= (TemperatureInterval / CYCLE_PERIOD)) {
      count = 0;
      text = String(AverageTemperature, TemperatureDigit);

      if (TempDisplay) {
        if (UsbSerial) {
          // USB SerialがONの時はJSONタイプ以外の温度データは送信しない
        }
        else {
          String result = Prefix + text + Suffix;
          MySerial.println(result);
        }
      }
    }

    temp_send_interval_count++;
    if (temp_send_interval_count >= (1000 / CYCLE_PERIOD)) {
      temp_send_interval_count = 0;
      if (roasting && roastTime < MAX_ROAST_TIME) {
        RoastData[roastTime] = AverageTemperature;
        SendTemperatureData(roastTime);
        roastTime += 1;
      }
      else {
        #define NO_ROASTING   -1
        SendTemperatureData(NO_ROASTING);
      }
    }

     vTaskDelay(delay); // FreeRTOS流のdelay
  }
}

//////////////////////////////////////////////////////////////////////////
void sendMessage(String message) {
  StaticJsonDocument<128> json;
  json["msg"] = message;

  String payload;
  serializeJson(json, payload);
  BroadcastMessage(payload);
}

//////////////////////////////////////////////////////////////////////////
void WebReceiveMsg(uint8_t *data, size_t len) {
  String command = "";
  for (size_t i = 0; i < len; i++) {
    command += (char)data[i];
  }
  command.trim();
  CommandProcess(command);
}

#if 0
//////////////////////////////////////////////////////////////////////////
void RGB_LEDSetup() {
	strip.begin();
	strip.setBrightness(10);	
}

void RGB_LEDLoop() {
  int m_color[5][3] = { {255, 0, 0}, {0, 255, 0}, {0, 0, 255}, {255, 255, 255}, {0, 0, 0} };
  strip.setLedColorData(0, m_color[0][0], m_color[0][1], m_color[0][2]);// Set color data.
  strip.show();   // Send color data to LED, and display.
}
#endif

//////////////////////////////////////////////////////////////////////////
void LowEnergySetUp(){
  btStop(); // Bluetoothを完全にOFF（WiFiと共存してると使ってる場合あり）
  preferences.begin("function", true); 
  bool lpm =preferences.getInt("lowpowermode", false);
  preferences.end();

  if (lpm) {
    setCpuFrequencyMhz(80); // デフォルト240MHz
    WiFi.setSleep(WIFI_PS_MIN_MODEM);   // ← Wi-Fi パワーセーブモード（推奨）
    WiFi.setTxPower(WIFI_POWER_7dBm);    // ← 送信電力を最小に（7dBm）
  }
  else {
    setCpuFrequencyMhz(240); // デフォルト240MHz
  }
}


//////////////////////////////////////////////////////////////////////////
void IOSetup() {
  pinMode(bootButtonPin, INPUT_PULLUP);  // BOOTボタンはプルアップで使う
  pinMode(2, OUTPUT);  // D2(オンLED) GPIO2 = 出力に設定
  ledcAttach(2, 5000, 8); // チャンネル0、周波数5kHz、8bit分解能、GPIO 2をチャンネル0に紐付け
}

//////////////////////////////////////////////////////////////////////////
void setup() {
  LowEnergySetUp();
  SerialSetup();
  if (!LittleFS.begin(true)) {  // true でFSがなかったら自己修復
    MySerial.println("LittleFSマウント失敗(自己修復済み)");
    return;
  }
    // LittleFSのファイルをWebサーバーとして提供
  ServerObject.serveStatic("/", LittleFS, "/");

  WiFiSetup();
  ServoSetup();
  ThermoCoupleSetup();
  TaskSetup();
  IOSetup();
  //RGB_LEDSetup();

  preferences.begin("temperature", true); // 読み取り専用
  TemperatureInterval = preferences.getInt("interval", TemperatureInterval);
  TemperatureDigit = preferences.getInt("digit", TemperatureDigit);
  Prefix = preferences.getString("prefix", Prefix);
  Suffix = preferences.getString("suffix", Suffix);
  TempDisplay =  preferences.getBool("temp_display", TempDisplay);
  SimulateCount =  preferences.getDouble("simulate_count", SimulateCount);
  TempOffset = preferences.getDouble("temp_offset", 0.0);
  TempGain = preferences.getDouble("temp_gain", 1.0);
  preferences.end();

  //ControlServo();

  // デバッグ用（リセットの度にカウントアップ）
  preferences.begin("system", false);
  int count = preferences.getInt("powerup_count", 0);
  preferences.putInt("powerup_count", (count + 1));
  preferences.end();
  MySerial.println(String("Power On Count: ") + String(count));
  
  preferences.begin("function", true);
  LEDTemperatureDisplay = preferences.getBool("ledtemp", false);
  LEDIPDisplay = preferences.getInt("ledip", IP_LED_OFF);
  bool wifiLog = preferences.getBool("wifi_log", false);  // デフォルトでWiFiエラー出さない
  preferences.end();
  if (wifiLog) {
    esp_log_level_set("wifi", ESP_LOG_WARN);  // これ設定してもエラーが表示されない。wifilogコマンドでONにすると出る（ちょっと時間おかないといけない？）
  }
  else {
    esp_log_level_set("wifi", ESP_LOG_NONE);
  }

 MySerial.println("Version: " + version + " / CodeName: " + CodeName);

    // オプションボタンの登録
  preferences.begin("function", true);
  String b_comm = preferences.getString("bpress", "templed on#templed off");  // デフォルトで温度表示⇔ステータス表示切り替え
  String bl_comm = preferences.getString("blpress", "reset"); // デフォルトでリセット
  preferences.end();
  parseCommands(b_comm, ButtonCommands, ButtonCommandCount, ButtonIndex);
  parseCommands(bl_comm, LongButtonCommands, LongButtonCommandCount, LongButtonIndex);

  esp_ota_mark_app_valid_cancel_rollback(); // ここまで来たらOTA成功、ということでロールバックをキャンセル
}
  
//////////////////////////////////////////////////////////////////////////
void ControlLED(bool onoff){
  if (onoff) {
    ledcWrite_(2, 255); // brightnessは0〜255
  }
  else {
    ledcWrite_(2, 0); // brightnessは0〜255
  }
}

//////////////////////////////////////////////////////////////////////////
void loop() {
  PollSerial();
  webSocket.loop();
  //ElegantOTA.loop();  // 2026.2.23
  delay(10);
  counterx++;
  wifiConnected = (WiFi.status() == WL_CONNECTED) || (WiFi.softAPgetStationNum() >= 1); // 2026.2.20 STAmode
  statusLEDProc();
  readBootButton();
  //RGB_LEDLoop();

  if (!(wifiConnected || /* webSocketConnected || */ UsbSerial)) {  // 2026.2.20 WiFi接続が解除されたらroastingもオフ
    roasting = false;
  }
  if (UsbSerial) return;  // USB接続時にWebSocketでは送信しない
  if ((counterx % 300) == 0) {
    sendMessage("KEEP_ALIVE");  // 3秒毎にキープアライブを送信
  }
}

void parseCommands(String str, String* targetArray, int& targetCount, int& targetIndex) {
  targetCount = 0; targetIndex = 0;
  str.trim();
  if (str.length() == 0) return;

  int fromIdx = 0;
  for (int i = 0; i < 5; i++) {
    int nextIdx = str.indexOf('#', fromIdx);
    if (nextIdx == -1) {
      String lastPart = str.substring(fromIdx);
      lastPart.trim();
      if (lastPart.length() > 0) targetArray[targetCount++] = lastPart;
      break;
    }
    String part = str.substring(fromIdx, nextIdx);
    part.trim();
    if (part.length() > 0) targetArray[targetCount++] = part;
    fromIdx = nextIdx + 1;
  }
}

void readBootButton() {
  bool State = digitalRead(bootButtonPin); // false: ON / true: OFF
  if (State == false) {
    LongButtonTimerCount++;
    if (LongButtonTimerCount == 300) { 
      if (LongButtonCommandCount > 0) {
        String exec = LongButtonCommands[LongButtonIndex];
        CommandProcess(exec);
        LongButtonIndex = (LongButtonIndex + 1) % LongButtonCommandCount;
        LongButtonTimerCount = 301; 
        MySerial.println(String("Button long press command: ") + exec);
      }
    }
  } 
  else {
    if (LongButtonTimerCount > 3 && LongButtonTimerCount < 300) {
      // 3カウント〜3秒未満なら「シングルプッシュ」
      if (ButtonCommandCount > 0) {
        String exec = ButtonCommands[ButtonIndex];
        CommandProcess(exec);
        ButtonIndex = (ButtonIndex + 1) % ButtonCommandCount;
        MySerial.println(String("Button press command: ") + exec);
      }
    }
    // 離したらリセット
    LongButtonTimerCount = 0;
  }
}

// Wrapper
//////////////////////////////////////////////////////////////////////////
void ledcWrite_(int pin, int brightness) {
    ledcWrite(pin, brightness);
}

//////////////////////////////////////////////////////////////////////////
void statusLEDProc() {
  if (LEDTemperatureDisplay || LEDIPDisplay){
    //  LEDDisplayTaskでLEDを制御する
    return;
  }

  if (roasting == true) {
    // 【高速点滅】 160ms周期でチカチカ
    ledcWrite_(2, ((counterx % 16) < 8) ? 255 : 0);
  }
  else if (wifiConnected || /* webSocketConnected || */ UsbSerial) {  // 2026.2.20 WebSocket接続からWiFi接続でLED点灯に変更
    int phase = counterx % 200; 
    int brightness = 0;
    if (phase < 100) {
      // 0〜99：上がっていくフェーズ
      brightness = (phase * phase) / 78; // 100*100 / 128 ≒ 78
    } else {
      // 100〜199：下がっていくフェーズ
      // (200 - phase) を使うことで、100の時に最大、200の時に0に収束させる！
      int rev_phase = 200 - phase; 
      brightness = (rev_phase * rev_phase) / 78;
    }
    ledcWrite_(2, brightness);  
    }
  else {
    ledcWrite_(2, 0); // 完全消灯
  }
}


//////////////////////////////////////////////////////////////////////////
void listDir(fs::FS &fs, const char * dirname, uint8_t levels) {
  File root = fs.open(dirname);
  if (!root || !root.isDirectory()) {
    MySerial.println("Failed to open directory");
    return;
  }

  File file = root.openNextFile();
  while (file) {
    if (file.isDirectory()) {
      MySerial.print("DIR  : ");
      MySerial.println(file.name());
      if (levels) {
        listDir(fs, file.name(), levels - 1);
      }
    } else {
      MySerial.print("FILE : ");
      MySerial.print(file.name());
      MySerial.print("\tSIZE: ");
      MySerial.println(file.size());
    }
    file = root.openNextFile();
  }
}

//////////////////////////////////////////////////////////////////////////
void CommandProcess(String& command, const uint8_t* params) {
  String str;
  int value;

  if (command.startsWith("reset")) {
    String arg = command.substring(6);
    if (arg == "all") {
      preferences.begin("wifi", false);
      preferences.putString("ssid", Ssid);
      preferences.putString("pass", Password);
      preferences.putString("stassid", StaSsid);
      preferences.putString("stapass", StaPass);
      IPAddressMemory[0] = DefaultAPIPAddress0;
      IPAddressMemory[1] = DefaultAPIPAddress1;
      IPAddressMemory[2] = DefaultAPIPAddress2;
      IPAddressMemory[3] = DefaultAPIPAddress3;
      preferences.putInt("address0", IPAddressMemory[0]);
      preferences.putInt("address1", IPAddressMemory[1]);
      preferences.putInt("address2", IPAddressMemory[2]);
      preferences.putInt("address3", IPAddressMemory[3]);
      preferences.putBool("wifi_log", false);
      preferences.putInt("maxwifi", MAX_WIFI_CONNECTION);
      preferences.putString("wifimode", "ap");   // APモードで起動するよう保存

      preferences.end();
      MySerial.println(String("SSID: ") + Ssid);
      MySerial.println(String("Password: ") + Password);
      MySerial.print("IP address: 192.168.4.1");

      int interval = 500;
      int digit = 1;
      String prefix = "";
      String suffix = "";
      bool temp_display = true;
      double simulate_count = 0.0; 
      preferences.begin("temperature", false);
      preferences.putInt("interval", interval);
      preferences.putInt("digit", digit);
      preferences.putString("prefix", prefix);
      preferences.putString("suffix", suffix);
      preferences.putBool("temp_display", temp_display);
      preferences.putDouble("simulate_count", simulate_count);
      preferences.putDouble("temp_offset", 0.0);
      preferences.putDouble("temp_gain", 1.0);
      preferences.end();

      MySerial.println("Temperature interval: " + String(interval) + "[ms]");
      MySerial.println("Temperature fraction digit: " + String(digit) + "[ms]");
      MySerial.println("Removed prefix and suffix.");
      MySerial.println("Temperature Display: ON");
      MySerial.println("Resetting UZU ROASTER System...");

      preferences.begin("function", false);
      preferences.putString("bpress", "templed on#templed off");
      preferences.putString("blpress", "reset");
      preferences.putBool("ledtemp", false);
      preferences.putInt("ledip", IP_LED_OFF);
      preferences.getInt("lowpowermode", false);
      preferences.end();
      delay(100);     
    }
    roasting = false;
    MySerial.println("Resetting UZU ROASTER System...");
    ESP.restart();
  }
  else if (command == "wifi on") {
      WiFiSetup();
  }
  else if (command == "wifi off") {
      WiFiOff();
  }
  else if (command == "ssid") {
    preferences.begin("wifi", true); // 読み取り専用
    String ssid = preferences.getString("ssid", Ssid);
    preferences.end();
    MySerial.println(String("SSID: ") + ssid);
  }
  else if (command.startsWith("ssid ")) {
    str = command.substring(5);
    str.trim();
    bool doRestart = false;
    if (str.endsWith(" -r")) {
        doRestart = true;
        str = str.substring(0, str.length() - 3);
        str.trim();
    }
    MySerial.println("SSID: " + str);
    preferences.begin("wifi", false);
    preferences.putString("ssid", str);
    preferences.end();
    if (doRestart) {
        ESP.restart();
    }
  }
  else if (command == "password" || command.startsWith("password ")) {
    str = (command.length() > 9) ? command.substring(9) : "";
    str.trim();
    
    bool doRestart = false;
    if (str == "-r") {
        // password -r → クリアしてリスタート
        doRestart = true;
        str = "";
    } else if (str.endsWith(" -r")) {
        // password 12345678 -r
        doRestart = true;
        str = str.substring(0, str.length() - 3);
        str.trim();
    }
    
    if (str.length() < 8 && str.length() > 0) {
        MySerial.println("Error: Password must be at least 8 characters!");
        return;
    }
    
    if (str == "") {
        MySerial.println("Password: No Password");
    } else {
        MySerial.println("Password: " + str);
    }
    
    preferences.begin("wifi", false);
    preferences.putString("pass", str);
    preferences.end();
    
    if (doRestart) {
        ESP.restart();
    }
  }
  else if (command == "stassid") {
    MySerial.println(String("STA SSID: ") + CurrentStaSsid);  // 2026.2.19
  }
  else if (command.startsWith("stassidclear")) {
    preferences.begin("wifi", false);
    preferences.putString("stassid", StaSsid);  // デフォルトに設定
    preferences.putString("stapass", StaPass);  // デフォルトに設定
    preferences.end();
    MySerial.println(String("STA SSID:"));
    CurrentStaSsid = StaSsid; 
    CurrentStaPassword = StaPass; 
    str = command.substring(12);
    if (str.endsWith(" -r")) {
      ESP.restart();
    }
  }
  else if (command.startsWith("stassid ")) {
    str = command.substring(8);
    str.trim();
    bool doRestart = false;
    if (str.endsWith(" -r")) {
        doRestart = true;
        str = str.substring(0, str.length() - 3);
        str.trim();
    }
    CurrentStaSsid = str;
    MySerial.println("STA SSID: " + CurrentStaSsid);
    preferences.begin("wifi", false);
    preferences.putString("stassid", CurrentStaSsid);
    preferences.end();
    if (doRestart) {
        ESP.restart();
    }
  }
  else if (command == "stapassword" || command.startsWith("stapassword ")) {
    str = (command.length() > 12) ? command.substring(12) : "";
    str.trim();
    bool doRestart = false;
    if (str == "-r") {
        doRestart = true;
        str = "";
    } else if (str.endsWith(" -r")) {
        // stapassword mypass12 -r
        doRestart = true;
        str = str.substring(0, str.length() - 3);
        str.trim();
    }
    if (str.length() < 8 && str.length() > 0) {
      MySerial.println("Error: Password must be at least 8 characters!");
      return;
    }
    if (str == "") {
      MySerial.println("STA Password: No Password");
    } else {
      MySerial.println("STA Password: " + str);
    }
    preferences.begin("wifi", false);
    preferences.putString("stapass", str);
    preferences.end();
    CurrentStaPassword = str;
    if (doRestart) {
      ESP.restart();
    }
  }
  else if (command == "wifimode") {
    preferences.begin("wifi", true);
    String str = preferences.getString("wifimode", "ap");  
    preferences.end();
    str.toUpperCase();
    MySerial.println((String)"WiFi: " + str + (String)" mode.");
  }
  else if (command == "wifimode sta") {
    preferences.begin("wifi", false);
    preferences.putString("wifimode", "sta");  // STAモードで起動するよう保存
    preferences.end();
    MySerial.println("WiFi: STA mode after restart.");
    delay(100);
    ESP.restart();
  }
  else if (command == "wifimode ap") {
    preferences.begin("wifi", false);
    preferences.putString("wifimode", "ap");   // APモードで起動するよう保存
    preferences.end();
    MySerial.println("WiFi: AP mode after restart.");
    delay(100);
    ESP.restart(); 
  }
  else if (command == "temp on") {
    MySerial.println("Temperature display ON.");
    TempDisplay = true;
    preferences.begin("temperature", false);
    preferences.putBool("temp_display", TempDisplay);
    preferences.end();
  }
  else if (command == "temp off") {
    MySerial.println("Temperature display OFF.");
    TempDisplay = false;
    preferences.begin("temperature", false);
    preferences.putBool("temp_display", TempDisplay);
    preferences.end();
  }
  else if (command.startsWith("interval ")) {
    str = command.substring(9);       
    str.trim();                              // 前後の空白や改行を削除
    value = str.toInt();                 // 数値に変換
    if (value > 0) {
      TemperatureInterval = value;
      preferences.begin("temperature", false);
      preferences.putInt("interval", value);
      preferences.end();
      MySerial.println("Temperature interval: " + String(TemperatureInterval) + "[ms]");
    } else {
      MySerial.println("Invalid interval value: " + str);
    }
  }      
  if (command == "toffset") {
    // 【UI: 確認モード】引数なしなら現在の値を表示
    MySerial.print("Current Temperature Offset: ");
    MySerial.print(TempOffset, 1);
    MySerial.println(" [deg]");
  } 
  else if (command == "toffset reset") {
    TempOffset = 0.0;
    preferences.begin("temperature", false);
    preferences.putDouble("temp_offset", 0.0);
    preferences.end();
    
    MySerial.println("Offset Reset to 0.0 [deg]");
  }
  else if (command.startsWith("toffset ")) {
    // 【UI: 設定モード】
    str = command.substring(8);
    str.trim();
    double floatValue = str.toDouble();
    // 入力バリデーション（数値かどうか）
    if (floatValue != 0 || str == "0" || str == "0.0" || str == "-0.0") {
      TempOffset = floatValue;    // - RawTemperature;
      preferences.begin("temperature", false);
      preferences.putDouble("temp_offset", floatValue);
      preferences.end();
      MySerial.print("Offset Updated: ");
      MySerial.print(TempOffset, 1);
      MySerial.println(" [deg]");
    } else {
      MySerial.println("Error: Invalid numeric value [" + str + "]");
    }
  }
    if (command == "tgain") {
    // 【UI: 確認モード】引数なしなら現在の値を表示
    MySerial.print("Current Temperature Gain: ");
    MySerial.println(TempGain, 4);
  } 
  else if (command == "tgain reset") {
    TempGain = 1.0;
    preferences.begin("temperature", false);
    preferences.putDouble("temp_gain", 1.0);
    preferences.end();
    
    MySerial.println("Gain Reset to 0.0 [deg]");
  }
  else if (command.startsWith("tgain ")) {
    double valA = command.substring(6).toDouble();
    if (valA >= 0.1 && valA <= 10.0) { // 暴走防止のガードレール
      TempGain = valA;
      preferences.begin("temperature", false);
      preferences.putDouble("temp_gain", TempGain);
      preferences.end();
      MySerial.print("Gain calibrated: a = ");
      MySerial.println(TempGain, 4);
    } else {
      MySerial.println("Error: Gain out of safe range (0.1 - 10.0)");
    }
  }
  else if (command.startsWith("tcalc ")) {
    String line = command;
    line.trim(); // 前後の空白を削除
    String parts[6]; // command + arg1..4 + 予備
    int partCount = 0;
    int from = 0;
    int to = line.indexOf(' ');
    while (to != -1 && partCount < 6) {
      parts[partCount++] = line.substring(from, to);
      from = to + 1;
      to = line.indexOf(' ', from);
    }
    if (partCount < 6) {
      parts[partCount++] = line.substring(from);
    }
    int argCount = partCount - 1; // 引数の数
        // 【エラーチェック】引数が2つでも4つでもない場合は即却下
    if (argCount != 2 && argCount != 4) {
      MySerial.println("Error: tcalc requires exactly 2 or 4 arguments.");
      return;
    }
    // 引数が2つの場合：Offset（切片）のみを再計算して保存
    else if (argCount == 2) {
      double ideal_L = parts[1].toDouble();
      double raw_L   = parts[2].toDouble();
      // 現在の gain (a) を維持したまま、新しい実測値に合わせて b を再計算
      // b = y - ax
      TempOffset = ideal_L - (TempGain * raw_L);
      
      MySerial.print("Mode: Offset Adjustment. New Offset: ");
      MySerial.println(TempOffset, 4);
      MySerial.println("Gain (a) remains unchanged.");
    }
    // 引数が4つの場合：Gain と Offset をフル校正
    else if (argCount == 4) {
      float ideal_L = parts[1].toFloat();
      float raw_L   = parts[2].toFloat();
      float ideal_H = parts[3].toFloat();
      float raw_H   = parts[4].toFloat();

      if (abs(raw_H - raw_L) < 0.0001) {
        MySerial.println("Error: Raw delta is zero. Division by zero prevented.");
        return;
      }
      else {
        TempGain = (ideal_H - ideal_L) / (raw_H - raw_L);
        TempOffset = ideal_L - (TempGain * raw_L);

        MySerial.println("Mode: Full Calibration");
        MySerial.print("New Gain  (a): "); Serial.println(TempGain, 4);
        MySerial.print("New Offset(b): "); Serial.println(TempOffset, 4);
      }
    }
    preferences.begin("temperature", false);
    preferences.putDouble("temp_gain", TempGain);
    preferences.putDouble("temp_offset", TempOffset);
    preferences.end();
  }
  else if (command.startsWith("digit ")) {
    str = command.substring(6);       // "temp "の後ろを取得
    str.trim();                              // 前後の空白や改行を削除
    value = str.toInt();                 // 数値に変換

    if ((value >= 0) && (value <= 5)) {
      TemperatureDigit = value;
      preferences.begin("temperature", false);
      preferences.putInt("digit", value);
      preferences.end();
      MySerial.println("Temperature fraction digit: " + String(TemperatureDigit));
    } else {
      MySerial.println("Invalid fraction digit value: " + str);
    }
  }     
  else if (command.startsWith("prefix ")) {
    int firstQuote = command.indexOf('"');
    int lastQuote = command.lastIndexOf('"');

    if (firstQuote != -1 && lastQuote != -1 && firstQuote < lastQuote) {
      // " と " の間に挟まれた中身を抽出（スペースもそのまま！）
      str = command.substring(firstQuote + 1, lastQuote);
    } else {
      // 囲みがない場合は、従来通り "prefix " の後から全部取る
      str = command.substring(7);
      str.trim();
    }
    preferences.begin("temperature", false);
    preferences.putString("prefix", str);
    preferences.end();
    Prefix = str;
    MySerial.println("Temperature text prefix: [" + str + "]");
  }
  else if (command == "prefix") {
    Prefix = "";
    preferences.begin("temperature", false);
    preferences.putString("prefix", "");
    preferences.end();
    MySerial.println("Temperature text prefix: (cleared)");
  }
  else if (command.startsWith("suffix ")) {
    int firstQuote = command.indexOf('"');
    int lastQuote = command.lastIndexOf('"');

    if (firstQuote != -1 && lastQuote != -1 && firstQuote < lastQuote) {
      str = command.substring(firstQuote + 1, lastQuote);
    } else {
      str = command.substring(7);
      str.trim();
    }
    preferences.begin("temperature", false);
    preferences.putString("suffix", str);
    preferences.end();
    Suffix = str;
    MySerial.println("Temperature text suffix: [" + str + "]");
  }
  else if (command == "suffix") {
    Suffix = "";
    preferences.begin("temperature", false);
    preferences.putString("suffix", "");
    preferences.end();
    MySerial.println("Temperature text suffix: (cleared)");
  }
  else if (command.startsWith("echo ")) {
    str = command.substring(5);       // "echo "の後ろを取得
    MySerial.println(str);
  }
  else if (command.startsWith("echon ")) {  // 数字をエコー
    str = command.substring(6);
    double temp = str.toDouble();         // 数値として取り出す
    MySerial.println(temp);               // 数値だけ送る
  }
  else if (command.startsWith("simulate ")) {
    str = command.substring(9);
    if (str == "on") {
      SimulateCount = 1.0;
      MySerial.println("Simulate set to ON.");
    }
    else if (str == "off") {
      SimulateCount = 0.0;
      MySerial.println("Simulate set to OFF.");
    }
    preferences.begin("temperature", false);
    preferences.putDouble("simulate_count", SimulateCount);
    preferences.end();
  }
  else if (command == "ip") {
    MySerial.print("IP address: ");
    MySerial.print(IPAddressMemory[0]);
    MySerial.print(".");
    MySerial.print(IPAddressMemory[1]);
    MySerial.print(".");
    MySerial.print(IPAddressMemory[2]);
    MySerial.print(".");
    MySerial.println(IPAddressMemory[3]);
  }
  else if (command.startsWith("ip ")) {
    str = command.substring(3);
    int count = sscanf(str.c_str(), "%d.%d.%d.%d", &IPAddressMemory[0], &IPAddressMemory[1], &IPAddressMemory[2], &IPAddressMemory[3]);
    if (count != 4) {
      MySerial.println("IP Address is not correct!");
      return;
    }
    preferences.begin("wifi", false);
    preferences.putInt("address0", IPAddressMemory[0]);
    preferences.putInt("address1", IPAddressMemory[1]);
    preferences.putInt("address2", IPAddressMemory[2]);
    preferences.putInt("address3", IPAddressMemory[3]);
    preferences.end();
    MySerial.println("IP Address is set to " + str);
    ESP.restart();
  }
  else if (command == "staip") {
    MySerial.print("STA IP address: ");;
    MySerial.println(WiFi.localIP());
  }
  else if (command == "ls") {
    if (!LittleFS.begin()) {
      MySerial.println("LittleFS mount failed!");
      return;
    }
    MySerial.println("LittleFS File List:");
    listDir(LittleFS, "/", 1); // 再帰深さは1で十分
  }
  else if (command.startsWith("cat ")) {
    String filename = command.substring(4);
    File file = LittleFS.open("/" + filename, "r");
    if (!file) {
      MySerial.println("Error: File not found.");
    } else {
      if (!UsbSerial) {
        MySerial.println("This command is not available for WebSocket.");
        return;
      }
      while (file.available()) {
        MySerial.print((char)file.read());
      }
      file.close();
      MySerial.println(); // 最後に改行
    }
  }
  else if (command.startsWith("rm ")) {
    String filename = command.substring(3);
    if (LittleFS.exists("/" + filename)) {
      LittleFS.remove("/" + filename);
      MySerial.println("Deleted: " + filename);
    } else {
      MySerial.println("Error: File not found.");
    }
  }
  else if (command.startsWith("usbserial ")) {
    str = command.substring(10);
    if (str == "on") {
      UsbSerial = true;
      MySerial.println("USB Serial set to ON.");
    }
    else if (str == "off") {
      UsbSerial = false;
      MySerial.println("USB Serial set to OFF.");
    }
  }
  else if (command == "start") {  // USBから焙煎スタート受信
      roasting = true;
      roastTime = 0;
  }
  else if (command == "stop") {  // USBから焙煎ストップ受信
      roasting = false;
  }
  else if (command == "bpress") {
    str = command.substring(7);
    preferences.begin("function", false);
    preferences.putString("bpress", "");
    preferences.end();
    MySerial.println(String("Button press command reset."));
    ButtonCommandCount = 0;
    ButtonIndex = 0;
  }
  else if (command == "blpress") {
    preferences.begin("function", false);
    preferences.putString("blpress", "");
    preferences.end();
    MySerial.println(String("Button long press command reset."));
    LongButtonCommandCount = 0;
    LongButtonIndex = 0;
  }
  else if (command.startsWith("bpress ")) {
    str = command.substring(7);
    preferences.begin("function", false);
    preferences.putString("bpress", str);
    preferences.end();
    parseCommands(str, ButtonCommands, ButtonCommandCount, ButtonIndex);
    MySerial.println("Button press registered: " + str + " (Count: " + String(ButtonCommandCount) + ")");
  }
  else if (command.startsWith("blpress ")) {
  str = command.substring(8);
    preferences.begin("function", false);
    preferences.putString("blpress", str);
    preferences.end();
    parseCommands(str, LongButtonCommands, LongButtonCommandCount, LongButtonIndex);
    MySerial.println("Button long press registered: " + str + " (Count: " + String(LongButtonCommandCount) + ")");
  }
  else if (command.startsWith("templed ")) {
    str = command.substring(8);
    if (str == "on") {
      LEDTemperatureDisplay = true;
      LEDIPDisplay = IP_LED_OFF;  // STA IP表示とは排他
      MySerial.println("LED Temperature Display: ON");
    }
    else if (str == "off") {
      LEDTemperatureDisplay = false;
      MySerial.println("LED Temperature Display: OFF");
    }
    preferences.begin("function", false);
    preferences.putBool("ledtemp", LEDTemperatureDisplay);
    preferences.putInt("ledip", LEDIPDisplay);
    preferences.end();
  }
  else if (command.startsWith("maxwifi ")) {
    str = command.substring(8);
    str.trim();                          // 前後の空白や改行を削除
    value = str.toInt();                 // 数値に変換
    preferences.begin("wifi", false);
    preferences.putInt("maxwifi", value);
    preferences.end();
    MySerial.println("Max WiFi: " + str);
    delay(100);
    ESP.restart();
  }
  else if (command.startsWith("ipled ")) {
    str = command.substring(6);
    if (str == "ap") {
      LEDIPDisplay = IP_LED_AP;
      LEDTemperatureDisplay = false;  // 温度表示とは排他
      MySerial.println("LED IP Display: ON");
    }
    else if (str == "sta") {
      LEDIPDisplay = IP_LED_STA;
      LEDTemperatureDisplay = false;  // 温度表示とは排他
      MySerial.println("LED IP Display: ON");
    }
    else if (str == "off") {
      LEDIPDisplay = IP_LED_OFF;
      MySerial.println("LED IP Display: OFF");
    }
    preferences.begin("function", false);
    preferences.putBool("ledtemp", LEDTemperatureDisplay);
    preferences.putInt("ledip", LEDIPDisplay);
    preferences.end();
  }
  else if (command.startsWith("lowenergy ")) {
    str = command.substring(10);
    bool lpm;
    if (str == "on") {
      lpm = true;
      MySerial.println("Low Energy Mode: ON");
    }
    else if (str == "off") {
      lpm = false;
      MySerial.println("Low Energy Mode: OFF");
    }
    preferences.begin("function", false);
    preferences.putInt("lowpowermode", lpm);
    preferences.end();
    delay(100);
    ESP.restart();
  }
  else if (command == "wifiscan") {
    MySerial.println("Scanning WiFi networks...");
    int n = WiFi.scanNetworks(false, true);  // false=ブロッキング, true=隠しSSIDも表示
    if (n == WIFI_SCAN_FAILED) {
        MySerial.println("Scan failed.");
    } else if (n == 0) {
        MySerial.println("No networks found.");
    } else {
        MySerial.println(String(n) + " networks found:");
        for (int i = 0; i < n; i++) {
            MySerial.println(String(i) + ": " + WiFi.SSID(i) + " (" + WiFi.RSSI(i) + "dBm)");
        }
    }
    WiFi.scanDelete();
  }
  else if (command == "status") {
    String led_disp = (LEDIPDisplay == IP_LED_STA) ? "STA" : ((LEDIPDisplay == IP_LED_AP) ? "AP" : "off");
    preferences.begin("wifi", true);
    String ssid      = preferences.getString("ssid", Ssid);
    String stassid   = preferences.getString("stassid", "");
    bool   wifiLog   = preferences.getBool("wifi_log", false);
    int   max_wifi   = preferences.getInt("maxwifi", MAX_WIFI_CONNECTION);
    String wifimode  = preferences.getString("wifimode", "ap");  
    wifimode.toUpperCase();
    preferences.end();

    preferences.begin("temperature", true);
    int  interval = preferences.getInt("interval", TemperatureInterval);
    int  digit    = preferences.getInt("digit", TemperatureDigit);
    String prefix = preferences.getString("prefix", "");
    String suffix = preferences.getString("suffix", "");
    bool tempDisp = preferences.getBool("temp_display", true);
    preferences.end();

    preferences.begin("function", true);
    String bpress  = preferences.getString("bpress", "templed on#templed off");
    String blpress = preferences.getString("blpress", "reset");
    bool lpm =preferences.getInt("lowpowermode", false);
    preferences.end();

    MySerial.println("========== UZU ROASTER STATUS ==========");
    // システム
    MySerial.println("[System]");
    MySerial.println("  Version       : " + version + " / CodeName: " + CodeName);
    // WiFi
    MySerial.println("[WiFi]");
    MySerial.println("  AP SSID       : " + ssid);
    MySerial.println("  AP IP         : " + WiFi.softAPIP().toString());
    MySerial.println("  AP Clients    : " + String(WiFi.softAPgetStationNum()));
    MySerial.println("  STA SSID      : " + (stassid == "" ? "(none)" : stassid));
    MySerial.println("  STA IP        : " + (WiFi.localIP().toString() == "0.0.0.0" ? "(not connected)" : WiFi.localIP().toString()));
    MySerial.println("  STA Status    : " + String(WiFi.status() == WL_CONNECTED ? "Connected" : "Disconnected"));
    MySerial.println("  WiFi log      : " + String(wifiLog ? "on" : "off"));
    MySerial.println("  Max WiFis     : " + String(max_wifi));
    MySerial.println("  Low Energy    : " + String(lpm ? "on" : "off"));
    MySerial.println("  WiFi          : " + wifimode + (String)" mode.");
    // 温度
    MySerial.println("[Temperature]");
    MySerial.println("  Current temp  : " + String(AverageTemperature, TemperatureDigit) + " deg");
    MySerial.println("  Temp display  : " + String(tempDisp ? "on" : "off"));
    MySerial.println("  Interval      : " + String(interval) + " ms");
    MySerial.println("  Digit         : " + String(digit));
    MySerial.println("  Prefix        : " + (prefix == "" ? "(none)" : prefix));
    MySerial.println("  Suffix        : " + (suffix == "" ? "(none)" : suffix));
    MySerial.print("  Correction    : y = ");
    MySerial.print(TempGain, 4); MySerial.print("x + (");  MySerial.print(TempOffset, 1); MySerial.println(")");
    // 焙煎
    MySerial.println("[Roasting]");
    MySerial.println("  Roasting      : " + String(roasting ? "yes" : "no"));
    MySerial.println("  Roast time    : " + String(roastTime) + " sec");
    MySerial.println("  Simulate      : " + String(SimulateCount > 0 ? "on" : "off"));
    // LED
    MySerial.println("[LED]");
    MySerial.println("  Temp LED      : " + String(LEDTemperatureDisplay ? "on" : "off"));
    MySerial.println("  IP LED        : " + led_disp);
    // ボタン
    MySerial.println("[Button]");
    MySerial.println("  Short press   : " + (bpress == "" ? "(none)" : bpress));
    MySerial.println("  Long press    : " + (blpress == "" ? "(none)" : blpress));
    MySerial.println("========================================");
  }
  else if (command.startsWith("wifilog ")) {  // 非公開コマンド
    str = command.substring(8);
    if (str == "off") {
        esp_log_level_set("wifi", ESP_LOG_NONE);
        preferences.begin("wifi", false);
        preferences.putBool("wifi_log", false);
        preferences.end();
        MySerial.println("WiFi log suppressed.");
    }
    else if (str == "on") {
        esp_log_level_set("wifi", ESP_LOG_WARN);
        preferences.begin("wifi", false);
        preferences.putBool("wifi_log", true);
        preferences.end();
        MySerial.println("WiFi log restored.");
    }
  }
  else if (command == "status -h") {
    MySerial.println("========== HARDWARE STATUS ==========");
    // CPU
    MySerial.println("[CPU]");
    MySerial.println("  CPU freq      : " + String(getCpuFrequencyMhz()) + " MHz");
    MySerial.println("  CPU0 (APP)    : " + String(xPortGetCoreID()) + " (current core)");
    MySerial.println("  XTAL freq     : " + String(getXtalFrequencyMhz()) + " MHz");
    MySerial.println("  APB freq      : " + String(getApbFrequency() / 1000000) + " MHz");
    // メモリ
    MySerial.println("[Memory]");
    MySerial.println("  Free heap     : " + String(ESP.getFreeHeap()) + " bytes");
    MySerial.println("  Min free heap : " + String(ESP.getMinFreeHeap()) + " bytes");
    MySerial.println("  Max alloc     : " + String(ESP.getMaxAllocHeap()) + " bytes");
    MySerial.println("  PSRAM size    : " + String(ESP.getPsramSize()) + " bytes");
    MySerial.println("  Free PSRAM    : " + String(ESP.getFreePsram()) + " bytes");    
    // Flash
    MySerial.println("[Flash]");
    MySerial.println("  Flash size    : " + String(ESP.getFlashChipSize()) + " bytes");
    MySerial.println("  Flash speed   : " + String(ESP.getFlashChipSpeed() / 1000000) + " MHz");
    MySerial.println("  Sketch size   : " + String(ESP.getSketchSize()) + " bytes");
    MySerial.println("  Free sketch   : " + String(ESP.getFreeSketchSpace()) + " bytes");
    // LittleFS
    MySerial.println("[LittleFS]");
    MySerial.println("  Total         : " + String(LittleFS.totalBytes()) + " bytes");
    MySerial.println("  Used          : " + String(LittleFS.usedBytes()) + " bytes");
    MySerial.println("  Free          : " + String(LittleFS.totalBytes() - LittleFS.usedBytes()) + " bytes");
    // FreeRTOS
    MySerial.println("[FreeRTOS]");
    MySerial.println("  Tick count    : " + String(xTaskGetTickCount()));
    MySerial.println("  Task count    : " + String(uxTaskGetNumberOfTasks()));
    MySerial.println("  Stack(loop)   : " + String(uxTaskGetStackHighWaterMark(NULL)) + " bytes remaining");
    MySerial.println("  Stack(temp)   : " + String(uxTaskGetStackHighWaterMark(taskHandle)) + " bytes remaining");
    // チップ情報
    MySerial.println("[Chip]");
    MySerial.println("  Chip model    : " + String(ESP.getChipModel()));
    MySerial.println("  Chip rev      : " + String(ESP.getChipRevision()));
    MySerial.println("  Chip cores    : " + String(ESP.getChipCores()));
    MySerial.println("  MAC address   : " + WiFi.macAddress());
    MySerial.println("  SDK version   : " + String(ESP.getSdkVersion()));
    // リセット情報
    MySerial.println("[Reset]");
    MySerial.println("  Uptime        : " + String(millis() / 1000) + " sec");
    MySerial.println("[GPIO]");
    MySerial.println("  GPIO0  (BOOT)  : " + String(digitalRead(0)));
    MySerial.println("  GPIO2  (LED)   : " + String(digitalRead(2)));
    MySerial.println("  GPIO5  (CS)    : " + String(digitalRead(5)));
    MySerial.println("  GPIO14 (SERVO) : " + String(digitalRead(14)));
    MySerial.println("  GPIO18 (CLK)   : " + String(digitalRead(18)));
    MySerial.println("  GPIO19 (DO)    : " + String(digitalRead(19)));    MySerial.println("[Sensor]");
    MySerial.println("[Temperature]");
    MySerial.println("  Raw temp      : " + String(thermocouple.readCelsius()));
    MySerial.println("  Internal temp : " + String(thermocouple.readInternal()));
    MySerial.println("  Sensor error  : " + String(thermocouple.readError()));
    MySerial.println("  Error count   : " + String(tempErrorCount));
    MySerial.println("  Last valid    : " + String(lastValidTemp));
    MySerial.println("[WebSocket]");
    MySerial.println("  Connected clients : " + String(webSocket.connectedClients()));
    MySerial.println("  WS connected  : " + String(webSocketConnected ? "yes" : "no"));
    MySerial.println("==========================================");
  }
  else if (command == "help") {
    MySerial.println("Available commands:");
    MySerial.println("reset             - Resets the system and reboots.");
    MySerial.println("reset all         - Resets to factory settings.");
    MySerial.println("wifi <on/off>     - Enables or disables WiFi.");
    MySerial.println("ssid <text>       - Sets SSID (or displays current SSID if <text> is empty). Add '-r' at the end to restart.");
    MySerial.println("                    e.g.) ssid MyRouter / ssid MyRouter -r");
    MySerial.println("password <text>   - Sets WiFi password or clears it if <text> is empty. Add '-r' at the end to restart.");
    MySerial.println("                    Password must be 8 characters or more.");
    MySerial.println("                    e.g.) password mypass12 / stapassword mypass12 -r");
    MySerial.println("stassid <text>    - Sets STA SSID. Add '-r' at the end to restart.");
    MySerial.println("                    e.g.) stassid MyRouter / stassid MyRouter -r");
    MySerial.println("stassidclear      - Clears STA SSID, STA password and restarts.");
    MySerial.println("stapassword <text>- Sets STA password or clears it if <text> is empty. Add '-r' at the end to restart.");
    MySerial.println("                    Password must be 8 characters or more.");
    MySerial.println("                    e.g.) stapassword mypass12 / stapassword mypass12 -r");
    MySerial.println("temp <on/off>     - Enables or disables temperature output via USB-Serial.");
    MySerial.println("interval <number> - Sets temperature display interval [ms].");
    MySerial.println("digit <number>    - Sets temperature decimal places [0-2].");
    MySerial.println("prefix <text>     - Sets temperature text prefix via USB-Serial.");
    MySerial.println("suffix <text>     - Sets temperature text suffix via USB-Serial.");
    MySerial.println("echo <message>    - Prints <message> for testing via USB-Serial.");
    MySerial.println("echon <number>    - Prints <number> for testing via USB-Serial.");
    MySerial.println("simulate <on/off> - Enables or disables simulation mode (generates dummy data).");
    MySerial.println("ip <address>      - Sets a AP IP Address or displays IP Address if <address> is empty.");
    MySerial.println("                  - e.g.) ip 192.168.0.1)");
    MySerial.println("staip             - Displays STA IP Address.");
    MySerial.println("ls                - Lists files and directories in LittleFS.");
    MySerial.println("cat <file>        - Displays the contents of the specified file.");
    MySerial.println("rm <file>         - Deletes the specified file.");
    MySerial.println("usbserial <on/off>- Starts or stops JSON output {time, temp} via USB-Serial (Non-persistent) via USB-Serial.");
    MySerial.println("start             - Starts measurement via USB-Serial.");
    MySerial.println("stop              - Stops measurement via USB-Serial.");
    MySerial.println("bpress <command>  - Registers <command> for button press.");
    MySerial.println("blpress <command> - Registers <command> for button long press.");
    MySerial.println("templed <on/off>  - Displays temperature using 3 sets of LED blinks.");
    MySerial.println("                    Each digit (100s, 10s, 1s) is shown in sequence:");
    MySerial.println("                    [Blink Lengths]");
    MySerial.println("                    - 120ms (Short)  : Represents '1'");
    MySerial.println("                    - 400ms (Medium) : Represents '5'");
    MySerial.println("                    - 800ms (Long)   : Represents '0'");
    MySerial.println("                    [How to Read Example: 128 degrees]");
    MySerial.println("                    1st: 120ms(1) -> 2nd: 120msx2(2) -> 3rd: 400ms(5)+120msx3(3)");
    MySerial.println("                    (There is a short pause between each digit.)");
    MySerial.println("ipled <ap/sta/off>- Displays AP/STA IP Address using LED blinks.");
    MySerial.println("                    Each octet is shown in sequence (Roman numeral style):");
    MySerial.println("                    - 120ms (Short)  : Represents '1'");
    MySerial.println("                    - 400ms (Medium) : Represents '5'");
    MySerial.println("                    - 800ms (Long)   : Represents '0'");
    MySerial.println("                    Long pause between octets.");
    MySerial.println("wifiscan          - Scans for available WiFi networks.");
    MySerial.println("status            - Displays UZU ROASTER status.");
    MySerial.println("status -h         - Displays hardware status.");
    MySerial.println("wifilog <on/off>  - Displays wifi system log.");
    MySerial.println("wifimode <ap/sta> - changes WiFi mode(AP or STA) and restarts.");
    MySerial.println("maxwifi <number>  - Sets maximum WiFi connection(AP mode).");
    MySerial.println("lowenergy <on/off>- Sets low energy mode.");
    MySerial.println("tgain <number>    - Calculates and sets temperture gain - a as [y = ax + b] or displays a if <number> is empty.");
    MySerial.println("tgain reset       - Resets temperture gain to 1.");
    MySerial.println("toffset <number>  - Calculates and sets temperture offset - b as [y = ax + b] or displays b if <number> is empty.");
    MySerial.println("toffset reset     - Resets temperture offset to 0.");
    MySerial.println("tcalc <t1> <T1>   - Caluculates and sets temperture Offset by using t1(ideal temp) and T1(display temp).");
    MySerial.println("tcalc <t1> <T1> <t2> <T2> - Caluculates and sets temperture offset and gain by using t1,t2(ideal temp) and T1,T2(display temp).");
    MySerial.println("help              - Displays this help menu.");
  }
  else if (command == "getData" || command == "get_data") {  // Artisan command {"command":"getData","id":82225} ⇒response {"id":82225,"data":{"bt":20.3}}
    StaticJsonDocument<256> requestDoc;
    deserializeJson(requestDoc, params);
    long idx = requestDoc["id"]; 
    StaticJsonDocument<256> responseDoc;
    responseDoc["id"] = idx;
    responseDoc["uzcp"] = "1.0";
    responseDoc["type"] = "response";
    responseDoc["ts"] = 1700001020.0;     // 本来は現在のUNIXタイムスタンプを入れる場所
    responseDoc["src"] = "roaster-01";    // 自分の名前
    responseDoc["dst"] = "*"; // 送り先の名前
    responseDoc["ref_id"] = "cmd" + String(idx); // リクエストIDを参照
    responseDoc["status"] = "ok";
    // "data" という名前の新しい箱を作る
    JsonObject data_ = responseDoc.createNestedObject("data");
    // その箱の中に "bt" を入れる
    data_["bt"] = roundf(AverageTemperature * 10) / 10.0;
    String response;
    serializeJson(responseDoc, response);
    response += "\n";
    BroadcastMessage(response);
  }
  else if (command == "READ") { // Artisan TC4用
    // フォーマット: "0.00,BT,ET,0.00"
    String temptxt = String(AverageTemperature, TemperatureDigit);
    Serial.print("0.00,");
    Serial.print(temptxt); 
    Serial.print(",");
    Serial.print(temptxt); // 2つ目のセンサー、なければbt_temp
    Serial.println(",0.00");
  }
  else {
      //MySerial.println("Unknown command."); // "8t,gs" とかいうコマンドがArtisan（Behmor）から送られてきて反応するためコメントアウト
  }
}

//////////////////////////////////////////////////////////////////////////
String trimString(String str) {
  // 先頭の空白・改行・タブを削除
  while (str.length() > 0 && (str[0] == '\r' || str[0] == '\n' || str[0] == '\t')) {
    str.remove(0, 1);
  }

  // 末尾の空白・改行・タブを削除
  while (str.length() > 0 && (str[str.length() - 1] == '\r' || str[str.length() - 1] == '\n' || str[str.length() - 1] == '\t')) {
    str.remove(str.length() - 1);
  }

  return str;
}

//////////////////////////////////////////////////////////////////////////
void PollSerial() {
  static String command = "";

  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == '\n') {
      command.trim();
      CommandProcess(command);
      command = ""; // クリア
    }
    else {
      command += c;
    }
  }
}

//////////////////////////////////////////////////////////////////////////
void TaskSetup()
{
  // タスクを起動
  xTaskCreatePinnedToCore(
    ReadTempTask,         // タスク関数
    "My60HzTask",   // 名前
    4096,           // スタックサイズ（バイト）
    NULL,           // パラメータ
    1,              // 優先度
    &taskHandle,    // ハンドル格納先
    1               // CPUコア番号（0 or 1）
  );

  xTaskCreateUniversal(LEDDisplayTask, "TEMPERATURE_LED", 4096, NULL, 5, NULL, 0);
  xTaskCreateUniversal(WiFiInstectionTask, "WIFI_INSPECTION", 4096, NULL, 6, NULL, 0);
}

//////////////////////////////////////////////////////////////////////////
void SerialSetup()
{
  Serial.begin(SerialBaudRate);
}

//////////////////////////////////////////////////////////////////////////
void WiFiOff() {
  WiFi.disconnect(true);  // WiFi設定クリア
  WiFi.mode(WIFI_OFF); 
  MySerial.print("WiFi disconnected.\n");
  delay(100);
}

//////////////////////////////////////////////////////////////////////////
void WiFiSetup() {
  WiFi.onEvent(onWiFiEvent);
  preferences.begin("wifi", true); // 読み取り専用
  IPAddressMemory[0] = preferences.getInt("address0", DefaultAPIPAddress0);
  IPAddressMemory[1] = preferences.getInt("address1", DefaultAPIPAddress1);
  IPAddressMemory[2] = preferences.getInt("address2", DefaultAPIPAddress2);
  IPAddressMemory[3] = preferences.getInt("address3", DefaultAPIPAddress3);
  String ssid = preferences.getString("ssid", Ssid);
  String pass = preferences.getString("pass", Password);
  CurrentStaSsid = preferences.getString("stassid", StaSsid); 
  CurrentStaPassword = preferences.getString("stapass", StaPass);
  String wifimode = preferences.getString("wifimode", "ap");  // デフォルトはAP
  int max_wifi = preferences.getInt("maxwifi", MAX_WIFI_CONNECTION);
  preferences.end();

  //ElegantOTA.begin(&ServerObject);  // 2026.2.23

  if (wifimode == "sta") {  // STA mode
    WiFi.mode(WIFI_STA);
    if (CurrentStaSsid != "") {
      WiFi.begin(CurrentStaSsid, CurrentStaPassword); 
      ServerObject.begin();  // ← 追加！
      webSocket.begin();     // ← 追加！
      webSocket.onEvent(onWebSocketEvent);
      webSocket.enableHeartbeat(5000, 2000, 3);
    }
  } else {  // AP mode
    WiFi.mode(WIFI_AP);
    IpAddress_ = IPAddress(IPAddressMemory[0], IPAddressMemory[1], IPAddressMemory[2], IPAddressMemory[3]);
    WiFi.softAPConfig(IpAddress_, IpAddress_, SubNet);
    WiFi.softAP(ssid, pass, 1, 0, max_wifi); 
  }

  IPAddress my_ip = WiFi.softAPIP();
  MySerial.print("IP address: ");
  MySerial.println(my_ip.toString());
  MySerial.print("SSID(AP): ");
  MySerial.println(ssid);
   // エンドポイント登録（非同期の形式）
   String path = "/" + TemperaturePath;
  ServerObject.on(path.c_str(), HTTP_GET, [](AsyncWebServerRequest *request){
    double c = AverageTemperature;
    String json = "{\"temperature\": " + String(c) + "}";
    request->send(200, "application/json", json);
  });

  ServerObject.on("/generate_204", HTTP_GET, [](AsyncWebServerRequest *request){
    String ip = String(IPAddressMemory[0]) + "." + String(IPAddressMemory[1]) + "." + String(IPAddressMemory[2]) + "." + String(IPAddressMemory[3]);
    request->redirect(ip);
  });

// ファームウェアアップロード画面の表示
  ServerObject.on("/update", HTTP_GET, [](AsyncWebServerRequest *request){
    AsyncWebServerResponse *response = request->beginResponse(200, "text/html", updateIndex);
    // キャッシュを一切許可しないヘッダ
    response->addHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    response->addHeader("Pragma", "no-cache");
    response->addHeader("Expires", "0");
    request->send(response);
  });

  // 3. アップロード処理本体（.bin→firmware / その他→LittleFS 自動振り分け）
  ServerObject.on("/update", HTTP_POST, [](AsyncWebServerRequest *request){
    // アップロード完了後のレスポンス
    // LittleFSファイルの場合はUpdateは使わないのでhasError()はfalse扱い
    bool isFirmware = request->hasParam("_type", true) ? 
                      (request->getParam("_type", true)->value() == "firmware") : false;
    bool shouldReboot = isFirmware && !Update.hasError();
    AsyncWebServerResponse *response = request->beginResponse(200, "text/plain", 
      shouldReboot ? "OK. Rebooting..." : "OK");
    response->addHeader("Connection", "close");
    request->send(response);
    if (shouldReboot) {
      delay(1000);
      ESP.restart();
    }
  }, [](AsyncWebServerRequest *request, String filename, size_t index, uint8_t *data, size_t len, bool final){
    // ファイル名の拡張子で振り分け
    bool isBin = filename.endsWith(".bin");

    if (isBin) {
      // ===== Firmware OTA =====
      if (!index) {
        Serial.printf("[OTA] Firmware Start: %s\n", filename.c_str());
        if (!Update.begin(UPDATE_SIZE_UNKNOWN, U_FLASH)) {
          Update.printError(Serial);
        }
      }
      if (!Update.hasError()) {
        if (Update.write(data, len) != len) {
          Update.printError(Serial);
        }
      }
      if (final) {
        if (Update.end(true)) {
          Serial.printf("[OTA] Firmware Success: %u B\n", index + len);
        } else {
          Update.printError(Serial);
        }
      }
    } else {
      // ===== LittleFS ファイル書き込み =====
      // グローバルで管理（AsyncWebServerのuploadハンドラは同時1リクエスト想定）
      static File fsUploadFile;
      static String fsUploadPath;

      if (!index) {
        fsUploadPath = "/" + filename;
        Serial.printf("[FS] Upload Start: %s\n", fsUploadPath.c_str());
        // LittleFSはsetup()でマウント済みなのでbegin()不要
        if (LittleFS.exists(fsUploadPath)) {
          LittleFS.remove(fsUploadPath);
        }
        fsUploadFile = LittleFS.open(fsUploadPath, "w");
        if (!fsUploadFile) {
          Serial.println("[FS] Failed to open file for writing");
          return;
        }
        Serial.printf("[FS] File opened OK\n");
      }
      if (fsUploadFile && len) {
        size_t written = fsUploadFile.write(data, len);
        if (written != len) {
          Serial.printf("[FS] Write error: %u / %u\n", written, len);
        }
      }
      if (final) {
        if (fsUploadFile) {
          fsUploadFile.close();
          // 書き込み確認
          File check = LittleFS.open(fsUploadPath, "r");
          if (check) {
            Serial.printf("[FS] Upload Success: %s (%u B)\n", fsUploadPath.c_str(), check.size());
            check.close();
          } else {
            Serial.println("[FS] Upload verify failed!");
          }
        }
      }
    }
  });
    // 192.168.4.1/がリクエストされた時に返すWebサーバー設定（最後に設定しないとこれが優先される）
  ServerObject.on("/", HTTP_GET, [](AsyncWebServerRequest *req){
    req->send(LittleFS, "/index.html", "text/html");
  });

  ServerObject.onNotFound([](AsyncWebServerRequest *request){
    request->redirect("/");
  });
}

//////////////////////////////////////////////////////////////////////////
void onWiFiEvent(WiFiEvent_t event) {
    switch (event) {
        case ARDUINO_EVENT_WIFI_AP_START:
            //MySerial.println("AP Mode started.");
            webSocket.begin();
            webSocket.onEvent(onWebSocketEvent);
            webSocket.enableHeartbeat(10000, 3000, 3); // 2026.2.19 added 
            dnsServer.start(53, "*", IpAddress_);
            ServerObject.begin();
            //MySerial.println("WebSocket server started.");
            break;

        case ARDUINO_EVENT_WIFI_AP_STACONNECTED:  // 2026.2.19 Separated 
            MySerial.println("Client connected.");
            break;

        case ARDUINO_EVENT_WIFI_AP_STOP:  // ここには来ない。。。
            //MySerial.println("AP Mode stopped.");
            webSocket.disconnect(); // 全クライアントを切断
            break;
        case ARDUINO_EVENT_WIFI_AP_STADISCONNECTED:
            int num = webSocket.connectedClients();
            MySerial.print("Station or Client disconnected. Remaining: ");
            MySerial.println(num);
            //ESP.restart();  // 2026.2.18 modified 1つのWiFiしかつながないのでWiFi切れたら強制リスタート
              
              // webSocket.disconnect(); // 全クライアントを切断
              // webSocket.close();
              // delay(100); 
              // dnsServer.stop();
              // ServerObject.end();
              // WiFi.disconnect(true);
            break;
    }
}

//////////////////////////////////////////////////////////////////////////
void ServoSetup() {
  myservo.attach(ServoPWM_pin);  // サーボモーターをGPIO14に接続
  delay(10);  // 初期化のための待機
}

//////////////////////////////////////////////////////////////////////////
void ThermoCoupleSetup() {
  if (!thermocouple.begin()) {
    MySerial.println("Couldn't detect sensor.");
  }
}

//////////////////////////////////////////////////////////////////////////
double ReadThermoCouple() {
   if (thermocouple.readError()) {
    //MySerial.println("Thermocouple error!");
    return 0.0;
  }

  double temp = thermocouple.readCelsius();
  if (isnan(temp)) {
    //MySerial.println("Fail to read sensor.");
  }
  
  return temp;
}

//////////////////////////////////////////////////////////////////////////
double ReadThermoCoupleWithGuard() {
    double raw = ReadThermoCouple();
    if (abs(raw - lastValidTemp) > DEVIATION_TEMP) {
        tempErrorCount++;
        if (tempErrorCount < 3) { // 2回までは前値を返して様子見
            return lastValidTemp;
        }
        // 3回連続なら「これが真実！」と受け入れる
    }
    tempErrorCount = 0; // 正常ならリセット
    lastValidTemp = raw;
    return raw;
}

//////////////////////////////////////////////////////////////////////////
void SendTemperatureData(int time) {
    if (isnan(AverageTemperature) || isinf(AverageTemperature)) {
        MySerial.println("異常な温度値のため送信中止");
        return;
    }
    else if (AverageTemperature > 1200) AverageTemperature = 1200;  // 2026.02.18
    else if (AverageTemperature < 0) AverageTemperature = 0;

    StaticJsonDocument<128> json;

    json["time"] = time;
    json["temp"] = roundf(AverageTemperature * 10) / 10.0;
    String message;
    message.reserve(64);
    serializeJson(json, message);
    BroadcastMessage(message);
    SendUZCPTelemetry(time);
}

//////////////////////////////////////////////////////////////////////////
void BroadcastMessage(String &message) {
  if (UsbSerial) {
    MySerial.println(message);
  }
  else {
    if (wifiConnected) {  
        webSocket.broadcastTXT(message);
      } 
      else {
        // 送信パケットが詰まってスキップ（重くなるのを防ぐ）
    }
  }
}
  
//////////////////////////////////////////////////////////////////////////
// UZCP 1.0 telemetry送信
// 仕様: https://github.com/uzuuzuhonpo/uzcp
//////////////////////////////////////////////////////////////////////////
void SendUZCPTelemetry(int time) {
    StaticJsonDocument<256> doc;
    doc["uzcp"]    = "1.0";
    doc["type"]    = "telemetry";
    doc["ts"]      = (double)millis() / 1000.0;
    doc["src"]     = "uzu-roaster-01";
    doc["dst"]     = "*";

    JsonObject data = doc.createNestedObject("data");
    data["bt"]      = roundf(AverageTemperature * 10) / 10.0;
    data["elapsed"] = (time >= 0) ? time : 0;
    data["phase"]   = roasting ? "roasting" : "idle";

    String payload;
    payload.reserve(128);
    serializeJson(doc, payload);
    payload += "\n";
    BroadcastMessage(payload);
}

//////////////////////////////////////////////////////////////////////////
void onWebSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length) {
  if (type == WStype_CONNECTED) {
    webSocketConnected = true;
  }
  else if (type == WStype_DISCONNECTED) {
    webSocketConnected = false;
  }
  else if (type == WStype_TEXT) {
    StaticJsonDocument<256> json;
    DeserializationError err = deserializeJson(json, payload);
    if (err) {
      MySerial.println("JSON受信エラー");
      return;
    }
   
    //MySerial.printf("（（WS RX））%s\n", payload);

    // -----------------------------------------------
    // UZCP 1.0 command受信
    // 仕様: https://github.com/uzuuzuhonpo/uzcp
    // -----------------------------------------------
    const char* uzcp = json["uzcp"];
    if (uzcp != nullptr && String(uzcp) == "1.0") {
      const char* type_str = json["type"];
      const char* cmd      = json["cmd"];
      const char* id       = json["id"];

      if (type_str != nullptr && String(type_str) == "command" && cmd != nullptr) {
        String cmdStr = String(cmd);
        MySerial.println("[UZCP] command: " + cmdStr);

        // UZCP ack送信
        StaticJsonDocument<128> ack;
        ack["uzcp"]   = "1.0";
        ack["type"]   = "ack";
        ack["ref_id"] = id ? id : "";
        ack["src"]    = "uzu-roaster-01";
        ack["dst"]    = json["src"] | "*";
        ack["ts"]     = (double)millis() / 1000.0;

        if (cmdStr == "start") {
          roasting = true;
          roastTime = 0;
          ack["status"] = "ok";
          CommandProcess(cmdStr); 
          MySerial.println("[UZCP] Roasting started.");
        }
        else if (cmdStr == "stop") {
          roasting = false;
          ack["status"] = "ok";
          CommandProcess(cmdStr); 
          MySerial.println("[UZCP] Roasting stopped.");
        }
        else {
          ack["status"]     = "unsupported";
          ack["message"]    = "command not supported in this version";
        }

        String ackMsg;
        serializeJson(ack, ackMsg);
        webSocket.sendTXT(num, ackMsg);
      }
      return;
    }

    // -----------------------------------------------
    // 既存の command受信（後方互換 start/stop）
    // -----------------------------------------------
    const char* cmd = json["command"];
    const char* id  = json["id"];

    MySerial.println(cmd); 
    if (cmd != nullptr) {
      String cmdStr = String(cmd); 
      CommandProcess(cmdStr, payload); 
    }
    
    return;
  }
}

//////////////////////////////////////////////////////////////////////////
void ControlServo() {
  while(1)
  {
    myservo.write(0);   // サーボを0度に設定
    delay(500);        // 1秒待機
    myservo.write(90);  // サーボを90度に設定
    delay(500);        // 1秒待機
    myservo.write(180); // サーボを180度に設定
    delay(1000);        // 1秒待機

  }
}
