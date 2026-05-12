#define WEBSOCKETS_SERVER_CLIENT_MAX 16  // デフォルト4　ゾンビ対策で保険として
#define MAX_ROAST_TIME  1800
#define MAX_TEMPERATURE 260
#define MAX_WIFI_CONNECTION   1 //10  //デフォルト。複数繋げると切断時にWebSocketゴースト？が残って処理が重くなるため当面1個だけ接続許可(温度を送信するところをコメントアウトで問題なく動く)
#define ELEGANTOTA_USE_ASYNC_WEBSERVER 1 // OTAアップデート用(実際はElegantoTA.hのdefineを書き換える必要あり)

#include <deque>
#include <esp_wifi.h>
#include <WiFi.h>
#include <ElegantOTA.h>
#include <ESP32Servo.h>  
#include <LittleFS.h>
#include <ESPAsyncWebServer.h>
#include <WebSocketsServer.h>
#include <DNSServer.h>
#include "Adafruit_MAX31855.h"
#include "esp_pm.h"
#include <Preferences.h> 
#include <WebSerial.h>
#include <vector>
#include <algorithm>
#include <ArduinoJson.h>

//////////////////////////////////////////////////////////////////////////
// Global Variables
//////////////////////////////////////////////////////////////////////////
const String version = "1.1.0";
TaskHandle_t taskHandle;
AsyncWebServer ServerObject(80);
WebSocketsServer webSocket = WebSocketsServer(81);
Servo myservo;
DNSServer dnsServer;   // キャプティブポータル用 DNS
Preferences preferences;  

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
int IPAddressMemory[4] = { 192, 168, 4, 1 };  // デフォルトのUZU ROASTER IPアドレス
// 🔑 Wi-Fi設定
const String Ssid = "UZU-ROASTER";  // デフォルト
const String Password = ""; // デフォルト
IPAddress IpAddress_; 	// 後で設定可能
const IPAddress SubNet(255, 255, 255, 0); 	
bool UsbSerial = false;
bool LEDTemperatureDisplay = false;
bool LEDIPDisplay = false;  // IPアドレスをLEDで表示するモード

const String StaSsid = "";  // デフォルト
const String StaPass = "";  // デフォルト
String CurrentStaSsid = "";  // 現在の有効なSTA用SSID
String CurrentStaPassword = "";  // 現在の有効なSTA用Password

// センサーオブジェクト作成
Adafruit_MAX31855 thermocouple(ThermoCLK_pin, ThermoCS_pin, ThermoDO_pin);
double AverageTemperature = 0.0;
const String TemperaturePath = "temperature";

// オプションボタン登録関係
int LongButtonTimerCount = 0;
String ButtonCommands[5], LongButtonCommands[5];
int ButtonCommandCount = 0, ButtonIndex = 0;
int LongButtonCommandCount = 0, LongButtonIndex = 0;

//////////////////////////////////////////////////////////////////////////
#define FROM_WIFI 0
#define FROM_USB  1
class SerialWrapper {
private:
  int whereFrom;
  
public:
  SerialWrapper() : whereFrom(FROM_WIFI) {}
    
  void setWhereFrom(int type) {
    whereFrom = type;
  }
  
  // テンプレートで全ての型に対応
  template<typename T>
  void print(T value) {
    if (true) {
      Serial.print(value);
    }
  }
  
  template<typename T>
  void print(T value, int format) {
    if (true) {
      Serial.print(value, format);
    }
  }
  
  template<typename T>
  void println(T value) {
    if (true) {
      Serial.println(value);
    }
  }
  
  template<typename T>
  void println(T value, int format) {
    if (true) {
      Serial.println(value, format);
    }
  }
  
  void println() {
    if (true) {
      Serial.println();
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
    if (LEDIPDisplay == false) break; // モードが変わったらキャンセルしてすぐに温度表示に変更
  }
  vTaskDelay(pdMS_TO_TICKS(T_STAIP));
}

void TemperatureDisplayTask(void *pvParameters) {
  while (true) {
    if (LEDIPDisplay) {
      // IPアドレス表示モード
      IPAddress ip = WiFi.localIP();  // STAのIP
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
    AverageTemperature = avg; // 移動平均化処理された温度をグローバルに保存
    if (AverageTemperature > MAX_TEMPERATURE) {AverageTemperature = MAX_TEMPERATURE;}
    else if (AverageTemperature < 0.0) {AverageTemperature = 0.0;}

    if (++count >= (TemperatureInterval / CYCLE_PERIOD)) {
      count = 0;
      text = String(avg, TemperatureDigit);

      if (TempDisplay) {
        if (UsbSerial) {
          // USB SerialがONの時はJSONタイプ以外の温度データは送信しない
        }
        else {
          String result = Prefix + text + Suffix;
          Serial.println(result);
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

  webSocket.broadcastTXT(payload);
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

//////////////////////////////////////////////////////////////////////////
void LowEnergySetUp(){
  btStop(); // Bluetoothを完全にOFF（WiFiと共存してると使ってる場合あり）
  //esp_wifi_set_max_tx_power(40); // 最大78 → 40あたりにすると通信可能距離は短くなるけど省エネ
  setCpuFrequencyMhz(240); // デフォルト240MHz
  // 電力管理（Power Management）を有効にして、アイドル時はLight Sleepに入るように設定
  esp_pm_config_esp32_t pm_config = { // 2026.2.19　実際使ってない。　esp_pm_configure(&pm_config); が抜けてる
    .max_freq_mhz = 240,
    .min_freq_mhz = 80,
    .light_sleep_enable = true
  };
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
    Serial.println("LittleFSマウント失敗(自己修復済み)");
    return;
  }
    // LittleFSのファイルをWebサーバーとして提供
  ServerObject.serveStatic("/", LittleFS, "/");

  WiFiSetup();
  ServoSetup();
  ThermoCoupleSetup();
  TaskSetup();
  IOSetup();

  preferences.begin("temperature", true); // 読み取り専用
  TemperatureInterval = preferences.getInt("interval", TemperatureInterval);
  TemperatureDigit = preferences.getInt("digit", TemperatureDigit);
  Prefix = preferences.getString("prefix", Prefix);
  Suffix = preferences.getString("suffix", Suffix);
  TempDisplay =  preferences.getBool("temp_display", TempDisplay);
  SimulateCount =  preferences.getDouble("simulate_count", SimulateCount);
  preferences.end();

  //ControlServo();

  // デバッグ用（リセットの度にカウントアップ）
  preferences.begin("system", false);
  int count = preferences.getInt("powerup_count", 0);
  preferences.putInt("powerup_count", (count + 1));
  preferences.end();
  Serial.println(String("Power On Count: ") + String(count));
  
  preferences.begin("function", true);
  LEDTemperatureDisplay = preferences.getBool("ledtemp", false);
  LEDIPDisplay = preferences.getBool("ledip", false);
  bool wifiLog = preferences.getBool("wifi_log", false);  // デフォルトでWiFiエラー出さない
  preferences.end();
  if (wifiLog) {
    esp_log_level_set("wifi", ESP_LOG_WARN);  // これ設定してもエラーが表示されない。wifilogコマンドでONにすると出る（ちょっと時間おかないといけない？）
  }
  else {
    esp_log_level_set("wifi", ESP_LOG_NONE);
  }

 Serial.println("Version: " + version);

    // オプションボタンの登録
  preferences.begin("function", true);
  String b_comm = preferences.getString("bpress", "templed on#templed off");  // デフォルトで温度表示⇔ステータス表示切り替え
  String bl_comm = preferences.getString("blpress", "reset"); // デフォルトでリセット
  preferences.end();
  parseCommands(b_comm, ButtonCommands, ButtonCommandCount, ButtonIndex);
  parseCommands(bl_comm, LongButtonCommands, LongButtonCommandCount, LongButtonIndex);

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
  ElegantOTA.loop();  // 2026.2.23
  delay(10);
  counterx++;

  wifiConnected = (WiFi.status() == WL_CONNECTED) || (WiFi.softAPgetStationNum() >= 1); // 2026.2.20 STAmode
  //wifiConnected = (WiFi.softAPgetStationNum() >= 1); // 2026.2.20
  statusLEDProc();
  readBootButton();

  if (!(wifiConnected || /* webSocketConnected || */ UsbSerial)) {  // 2026.2.20 WiFi接続が解除されたらroastingもオフ
    roasting = false;
  }

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
        Serial.println(String("Button long press command: ") + exec);
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
        Serial.println(String("Button press command: ") + exec);
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
    //  TemperatureDisplayTaskでLEDを制御する
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
    Serial.println("Failed to open directory");
    return;
  }

  File file = root.openNextFile();
  while (file) {
    if (file.isDirectory()) {
      Serial.print("DIR  : ");
      Serial.println(file.name());
      if (levels) {
        listDir(fs, file.name(), levels - 1);
      }
    } else {
      Serial.print("FILE : ");
      Serial.print(file.name());
      Serial.print("\tSIZE: ");
      Serial.println(file.size());
    }
    file = root.openNextFile();
  }
}

//////////////////////////////////////////////////////////////////////////
void CommandProcess(String& command) {
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
      IPAddressMemory[0] = 192;
      IPAddressMemory[1] = 168;
      IPAddressMemory[2] = 4;
      IPAddressMemory[3] = 1;
      preferences.putInt("address0", IPAddressMemory[0]);
      preferences.putInt("address1", IPAddressMemory[1]);
      preferences.putInt("address2", IPAddressMemory[2]);
      preferences.putInt("address3", IPAddressMemory[3]);
      preferences.putBool("wifi_log", false);
      preferences.putInt("maxwifi", MAX_WIFI_CONNECTION);
      preferences.end();
      Serial.println(String("SSID: ") + Ssid);
      Serial.println(String("Password: ") + Password);
      Serial.print("IP address: 192.168.4.1");

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
      preferences.end();

      Serial.println("Temperature interval: " + String(interval) + "[ms]");
      Serial.println("Temperature fraction digit: " + String(digit) + "[ms]");
      Serial.println("Removed prefix and suffix.");
      Serial.println("Temperature Display: ON");
      Serial.println("Resetting UZU ROASTER System...");

      preferences.begin("function", false);
      preferences.putString("bpress", "templed on#templed off");
      preferences.putString("blpress", "reset");
      preferences.putBool("ledtemp", false);
      preferences.putBool("ledip", false);
      preferences.end();
      delay(100);     
    }
    roasting = false;
    Serial.println("Resetting UZU ROASTER System...");
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
    Serial.println(String("SSID: ") + ssid);
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
    Serial.println("SSID: " + str);
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
        Serial.println("Error: Password must be at least 8 characters!");
        return;
    }
    
    if (str == "") {
        Serial.println("Password: No Password");
    } else {
        Serial.println("Password: " + str);
    }
    
    preferences.begin("wifi", false);
    preferences.putString("pass", str);
    preferences.end();
    
    if (doRestart) {
        ESP.restart();
    }
  }
  else if (command == "stassid") {
    Serial.println(String("STA SSID: ") + CurrentStaSsid);  // 2026.2.19
  }
  else if (command.startsWith("stassidclear")) {
    preferences.begin("wifi", false);
    preferences.putString("stassid", StaSsid);  // デフォルトに設定
    preferences.putString("stapass", StaPass);  // デフォルトに設定
    preferences.end();
    Serial.println(String("STA SSID:"));
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
    Serial.println("STA SSID: " + CurrentStaSsid);
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
      Serial.println("Error: Password must be at least 8 characters!");
      return;
    }
    if (str == "") {
      Serial.println("STA Password: No Password");
    } else {
      Serial.println("STA Password: " + str);
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
    Serial.println((String)"WiFi: " + str + (String)" mode.");
  }
  else if (command == "wifimode sta") {
    preferences.begin("wifi", false);
    preferences.putString("wifimode", "sta");  // STAモードで起動するよう保存
    preferences.end();
    Serial.println("WiFi: STA mode after restart.");
    delay(100);
    ESP.restart();
  }
  else if (command == "wifimode ap") {
    preferences.begin("wifi", false);
    preferences.putString("wifimode", "ap");   // APモードで起動するよう保存
    preferences.end();
    Serial.println("WiFi: AP mode after restart.");
    delay(100);
    ESP.restart(); 
  }
  else if (command == "temp on") {
    Serial.println("Temperature display ON.");
    TempDisplay = true;
    preferences.begin("temperature", false);
    preferences.putBool("temp_display", TempDisplay);
    preferences.end();
  }
  else if (command == "temp off") {
    Serial.println("Temperature display OFF.");
    TempDisplay = false;
    preferences.begin("temperature", false);
    preferences.putBool("temp_display", TempDisplay);
    preferences.end();
  }
  else if (command.startsWith("interval ")) {
    str = command.substring(9);       // "temp "の後ろを取得
    str.trim();                              // 前後の空白や改行を削除
    value = str.toInt();                 // 数値に変換

    if (value > 0) {
      TemperatureInterval = value;
      preferences.begin("temperature", false);
      preferences.putInt("interval", value);
      preferences.end();
      Serial.println("Temperature interval: " + String(TemperatureInterval) + "[ms]");
    } else {
      Serial.println("Invalid interval value: " + str);
    }
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
      Serial.println("Temperature fraction digit: " + String(TemperatureDigit));
    } else {
      Serial.println("Invalid fraction digit value: " + str);
    }
  }     
  else if (command.startsWith("prefix ")) {
    str = command.substring(7);    
    str = trimString(str);
    preferences.begin("temperature", false);
    preferences.putString("prefix", str);
    preferences.end();
    Prefix = str;
    Serial.println("Temperature text prefix: " + str);
  }
  else if (command == "prefix") {
    preferences.begin("temperature", false);
    preferences.putString("prefix", "");
    preferences.end();
    Prefix = "";
    Serial.println("Temperature text prefix: ");
  }
  else if (command.startsWith("suffix ")) {
    str = command.substring(7);       // "temp "の後ろを取得
    str = trimString(str);
    preferences.begin("temperature", false);
    preferences.putString("suffix", str);
    preferences.end();
    Suffix = str;
    Serial.println("Temperature text suffix: " + str);
  }
  else if (command == "suffix") {
    preferences.begin("temperature", false);
    preferences.putString("suffix", "");
    preferences.end();
    Suffix = "";
    Serial.println("Temperature text suffix: ");
  }
  else if (command.startsWith("echo ")) {
    str = command.substring(5);       // "echo "の後ろを取得
    Serial.println(str);
  }
  else if (command.startsWith("echon ")) {  // 数字をエコー
    str = command.substring(6);
    double temp = str.toDouble();         // 数値として取り出す
    Serial.println(temp);               // 数値だけ送る
  }
  else if (command.startsWith("simulate ")) {
    str = command.substring(9);
    if (str == "on") {
      SimulateCount = 1.0;
      Serial.println("Simulate set to ON.");
    }
    else if (str == "off") {
      SimulateCount = 0.0;
      Serial.println("Simulate set to OFF.");
    }
    preferences.begin("temperature", false);
    preferences.putDouble("simulate_count", SimulateCount);
    preferences.end();
  }
  else if (command == "ip") {
    Serial.print("IP address: ");
    Serial.print(IPAddressMemory[0]);
    Serial.print(".");
    Serial.print(IPAddressMemory[1]);
    Serial.print(".");
    Serial.print(IPAddressMemory[2]);
    Serial.print(".");
    Serial.println(IPAddressMemory[3]);
  }
  else if (command.startsWith("ip ")) {
    str = command.substring(3);
    int count = sscanf(str.c_str(), "%d.%d.%d.%d", &IPAddressMemory[0], &IPAddressMemory[1], &IPAddressMemory[2], &IPAddressMemory[3]);
    if (count != 4) {
      Serial.println("IP Address is not correct!");
      return;
    }
    preferences.begin("wifi", false);
    preferences.putInt("address0", IPAddressMemory[0]);
    preferences.putInt("address1", IPAddressMemory[1]);
    preferences.putInt("address2", IPAddressMemory[2]);
    preferences.putInt("address3", IPAddressMemory[3]);
    preferences.end();
    Serial.println("IP Address is set to " + str);
    ESP.restart();
  }
  else if (command == "staip") {
    Serial.print("STA IP address: ");;
    Serial.println(WiFi.localIP());
  }
  else if (command == "ls") {
    if (!LittleFS.begin()) {
      Serial.println("LittleFS mount failed!");
      return;
    }
    Serial.println("LittleFS File List:");
    listDir(LittleFS, "/", 1); // 再帰深さは1で十分
  }
  else if (command.startsWith("cat ")) {
    String filename = command.substring(4);
    File file = LittleFS.open("/" + filename, "r");
    if (!file) {
      Serial.println("Error: File not found.");
    } else {
      Serial.println("Contents of " + filename + ":");
      while (file.available()) {
        Serial.write(file.read());
      }
      file.close();
      Serial.println(); // 最後に改行
    }
  }
  else if (command.startsWith("rm ")) {
    String filename = command.substring(3);
    if (LittleFS.exists("/" + filename)) {
      LittleFS.remove("/" + filename);
      Serial.println("Deleted: " + filename);
    } else {
      Serial.println("Error: File not found.");
    }
  }
  else if (command.startsWith("usbserial ")) {
    str = command.substring(10);
    if (str == "on") {
      UsbSerial = true;
      Serial.println("USB Serial set to ON.");
    }
    else if (str == "off") {
      UsbSerial = false;
      Serial.println("USB Serial set to OFF.");
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
    Serial.println(String("Button press command reset."));
    ButtonCommandCount = 0;
    ButtonIndex = 0;
  }
  else if (command == "blpress") {
    preferences.begin("function", false);
    preferences.putString("blpress", "");
    preferences.end();
    Serial.println(String("Button long press command reset."));
    LongButtonCommandCount = 0;
    LongButtonIndex = 0;
  }
  else if (command.startsWith("bpress ")) {
    str = command.substring(7);
    preferences.begin("function", false);
    preferences.putString("bpress", str);
    preferences.end();
    parseCommands(str, ButtonCommands, ButtonCommandCount, ButtonIndex);
    Serial.println("Button press registered: " + str + " (Count: " + String(ButtonCommandCount) + ")");
  }
  else if (command.startsWith("blpress ")) {
  str = command.substring(8);
    preferences.begin("function", false);
    preferences.putString("blpress", str);
    preferences.end();
    parseCommands(str, LongButtonCommands, LongButtonCommandCount, LongButtonIndex);
    Serial.println("Button long press registered: " + str + " (Count: " + String(LongButtonCommandCount) + ")");
  }
  else if (command.startsWith("templed ")) {
    str = command.substring(8);
    if (str == "on") {
      LEDTemperatureDisplay = true;
      LEDIPDisplay = false;  // STA IP表示とは排他
      Serial.println("LED Temperature Display: ON");
    }
    else if (str == "off") {
      LEDTemperatureDisplay = false;
      Serial.println("LED Temperature Display: OFF");
    }
    preferences.begin("function", false);
    preferences.putBool("ledtemp", LEDTemperatureDisplay);
    preferences.putBool("ledip", LEDIPDisplay);
    preferences.end();
  }
  else if (command.startsWith("maxwifi ")) {
    str = command.substring(8);
    str.trim();                          // 前後の空白や改行を削除
    value = str.toInt();                 // 数値に変換
    preferences.begin("wifi", false);
    preferences.putInt("maxwifi", value);
    preferences.end();
    Serial.println("Max WiFi: " + str);
    delay(100);
    ESP.restart();
  }
  else if (command.startsWith("ipled ")) {
    str = command.substring(6);
    if (str == "on") {
      LEDIPDisplay = true;
      LEDTemperatureDisplay = false;  // 温度表示とは排他
      Serial.println("LED IP Display: ON");
    }
    else if (str == "off") {
      LEDIPDisplay = false;
      Serial.println("LED IP Display: OFF");
    }
    preferences.begin("function", false);
    preferences.putBool("ledtemp", LEDTemperatureDisplay);
    preferences.putBool("ledip", LEDIPDisplay);
    preferences.end();
  }
  else if (command == "wifiscan") {
    Serial.println("Scanning WiFi networks...");
    int n = WiFi.scanNetworks(false, true);  // false=ブロッキング, true=隠しSSIDも表示
    if (n == WIFI_SCAN_FAILED) {
        Serial.println("Scan failed.");
    } else if (n == 0) {
        Serial.println("No networks found.");
    } else {
        Serial.println(String(n) + " networks found:");
        for (int i = 0; i < n; i++) {
            Serial.println(String(i) + ": " + WiFi.SSID(i) + " (" + WiFi.RSSI(i) + "dBm)");
        }
    }
    WiFi.scanDelete();
  }
  else if (command == "status") {
    preferences.begin("wifi", true);
    String ssid      = preferences.getString("ssid", Ssid);
    String stassid   = preferences.getString("stassid", "");
    bool   wifiLog   = preferences.getBool("wifi_log", false);
    int   max_wifi   = preferences.getInt("maxwifi", MAX_WIFI_CONNECTION);
    preferences.end();

    preferences.begin("temperature", true);
    int  interval = preferences.getInt("interval", TemperatureInterval);
    int  digit    = preferences.getInt("digit", TemperatureDigit);
    String prefix = preferences.getString("prefix", "");
    String suffix = preferences.getString("suffix", "");
    bool tempDisp = preferences.getBool("temp_display", true);
    preferences.end();

    preferences.begin("function", true);
    String bpress  = preferences.getString("bpress", "");
    String blpress = preferences.getString("blpress", "");
    preferences.end();

    Serial.println("========== UZU ROASTER STATUS ==========");
    // システム
    Serial.println("[System]");
    Serial.println("  Version       : " + version);
    // WiFi
    Serial.println("[WiFi]");
    Serial.println("  AP SSID       : " + ssid);
    Serial.println("  AP IP         : " + WiFi.softAPIP().toString());
    Serial.println("  AP Clients    : " + String(WiFi.softAPgetStationNum()));
    Serial.println("  STA SSID      : " + (stassid == "" ? "(none)" : stassid));
    Serial.println("  STA IP        : " + (WiFi.localIP().toString() == "0.0.0.0" ? "(not connected)" : WiFi.localIP().toString()));
    Serial.println("  STA Status    : " + String(WiFi.status() == WL_CONNECTED ? "Connected" : "Disconnected"));
    Serial.println("  WiFi log      : " + String(wifiLog ? "on" : "off"));
    Serial.println("  Max WiFis     : " + String(max_wifi));
    // 温度
    Serial.println("[Temperature]");
    Serial.println("  Current temp  : " + String(AverageTemperature, TemperatureDigit) + " C");
    Serial.println("  Temp display  : " + String(tempDisp ? "on" : "off"));
    Serial.println("  Interval      : " + String(interval) + " ms");
    Serial.println("  Digit         : " + String(digit));
    Serial.println("  Prefix        : " + (prefix == "" ? "(none)" : prefix));
    Serial.println("  Suffix        : " + (suffix == "" ? "(none)" : suffix));
    // 焙煎
    Serial.println("[Roasting]");
    Serial.println("  Roasting      : " + String(roasting ? "yes" : "no"));
    Serial.println("  Roast time    : " + String(roastTime) + " sec");
    Serial.println("  Simulate      : " + String(SimulateCount > 0 ? "on" : "off"));
    // LED
    Serial.println("[LED]");
    Serial.println("  Temp LED      : " + String(LEDTemperatureDisplay ? "on" : "off"));
    Serial.println("  IP LED        : " + String(LEDIPDisplay ? "on" : "off"));
    // ボタン
    Serial.println("[Button]");
    Serial.println("  Short press   : " + (bpress == "" ? "(none)" : bpress));
    Serial.println("  Long press    : " + (blpress == "" ? "(none)" : blpress));
    Serial.println("========================================");
  }
  else if (command.startsWith("wifilog ")) {  // 非公開コマンド
    str = command.substring(8);
    if (str == "off") {
        esp_log_level_set("wifi", ESP_LOG_NONE);
        preferences.begin("wifi", false);
        preferences.putBool("wifi_log", false);
        preferences.end();
        Serial.println("WiFi log suppressed.");
    }
    else if (str == "on") {
        esp_log_level_set("wifi", ESP_LOG_WARN);
        preferences.begin("wifi", false);
        preferences.putBool("wifi_log", true);
        preferences.end();
        Serial.println("WiFi log restored.");
    }
  }
  else if (command == "status -h") {
    Serial.println("========== HARDWARE STATUS ==========");
    // CPU
    Serial.println("[CPU]");
    Serial.println("  CPU freq      : " + String(getCpuFrequencyMhz()) + " MHz");
    Serial.println("  CPU0 (APP)    : " + String(xPortGetCoreID()) + " (current core)");
    Serial.println("  XTAL freq     : " + String(getXtalFrequencyMhz()) + " MHz");
    Serial.println("  APB freq      : " + String(getApbFrequency() / 1000000) + " MHz");
    // メモリ
    Serial.println("[Memory]");
    Serial.println("  Free heap     : " + String(ESP.getFreeHeap()) + " bytes");
    Serial.println("  Min free heap : " + String(ESP.getMinFreeHeap()) + " bytes");
    Serial.println("  Max alloc     : " + String(ESP.getMaxAllocHeap()) + " bytes");
    Serial.println("  PSRAM size    : " + String(ESP.getPsramSize()) + " bytes");
    Serial.println("  Free PSRAM    : " + String(ESP.getFreePsram()) + " bytes");    
    // Flash
    Serial.println("[Flash]");
    Serial.println("  Flash size    : " + String(ESP.getFlashChipSize()) + " bytes");
    Serial.println("  Flash speed   : " + String(ESP.getFlashChipSpeed() / 1000000) + " MHz");
    Serial.println("  Sketch size   : " + String(ESP.getSketchSize()) + " bytes");
    Serial.println("  Free sketch   : " + String(ESP.getFreeSketchSpace()) + " bytes");
    // LittleFS
    Serial.println("[LittleFS]");
    Serial.println("  Total         : " + String(LittleFS.totalBytes()) + " bytes");
    Serial.println("  Used          : " + String(LittleFS.usedBytes()) + " bytes");
    Serial.println("  Free          : " + String(LittleFS.totalBytes() - LittleFS.usedBytes()) + " bytes");
    // FreeRTOS
    Serial.println("[FreeRTOS]");
    Serial.println("  Tick count    : " + String(xTaskGetTickCount()));
    Serial.println("  Task count    : " + String(uxTaskGetNumberOfTasks()));
    Serial.println("  Stack(loop)   : " + String(uxTaskGetStackHighWaterMark(NULL)) + " bytes remaining");
    Serial.println("  Stack(temp)   : " + String(uxTaskGetStackHighWaterMark(taskHandle)) + " bytes remaining");
    // チップ情報
    Serial.println("[Chip]");
    Serial.println("  Chip model    : " + String(ESP.getChipModel()));
    Serial.println("  Chip rev      : " + String(ESP.getChipRevision()));
    Serial.println("  Chip cores    : " + String(ESP.getChipCores()));
    Serial.println("  MAC address   : " + WiFi.macAddress());
    Serial.println("  SDK version   : " + String(ESP.getSdkVersion()));
    // リセット情報
    Serial.println("[Reset]");
    Serial.println("  Uptime        : " + String(millis() / 1000) + " sec");
    Serial.println("[GPIO]");
    Serial.println("  GPIO0  (BOOT)  : " + String(digitalRead(0)));
    Serial.println("  GPIO2  (LED)   : " + String(digitalRead(2)));
    Serial.println("  GPIO5  (CS)    : " + String(digitalRead(5)));
    Serial.println("  GPIO14 (SERVO) : " + String(digitalRead(14)));
    Serial.println("  GPIO18 (CLK)   : " + String(digitalRead(18)));
    Serial.println("  GPIO19 (DO)    : " + String(digitalRead(19)));    Serial.println("[Sensor]");
    Serial.println("[Temperature]");
    Serial.println("  Raw temp      : " + String(thermocouple.readCelsius()));
    Serial.println("  Internal temp : " + String(thermocouple.readInternal()));
    Serial.println("  Sensor error  : " + String(thermocouple.readError()));
    Serial.println("  Error count   : " + String(tempErrorCount));
    Serial.println("  Last valid    : " + String(lastValidTemp));
    Serial.println("[WebSocket]");
    Serial.println("  Connected clients : " + String(webSocket.connectedClients()));
    Serial.println("  WS connected  : " + String(webSocketConnected ? "yes" : "no"));
    Serial.println("==========================================");
  }
  else if (command == "help") {
    Serial.println("Available commands:");
    Serial.println("reset             - Resets the system and reboots.");
    Serial.println("reset all         - Resets to factory settings.");
    Serial.println("wifi <on/off>     - Enables or disables WiFi.");
    Serial.println("ssid <text>       - Sets SSID (or displays current SSID if <text> is empty). Add '-r' at the end to restart.");
    Serial.println("                    e.g.) ssid MyRouter / ssid MyRouter -r");
    Serial.println("password <text>   - Sets WiFi password or clears it if <text> is empty. Add '-r' at the end to restart.");
    Serial.println("                    Password must be 8 characters or more.");
    Serial.println("                    e.g.) password mypass12 / stapassword mypass12 -r");
    Serial.println("stassid <text>    - Sets STA SSID. Add '-r' at the end to restart.");
    Serial.println("                    e.g.) stassid MyRouter / stassid MyRouter -r");
    Serial.println("stassidclear      - Clears STA SSID, STA password and restarts.");
    Serial.println("stapassword <text>- Sets STA password or clears it if <text> is empty. Add '-r' at the end to restart.");
    Serial.println("                    Password must be 8 characters or more.");
    Serial.println("                    e.g.) stapassword mypass12 / stapassword mypass12 -r");
    Serial.println("temp <on/off>     - Enables or disables temperature output via USB-Serial.");
    Serial.println("interval <number> - Sets temperature display interval [ms].");
    Serial.println("digit <number>    - Sets temperature decimal places [0-2].");
    Serial.println("prefix <text>     - Sets temperature text prefix via USB-Serial.");
    Serial.println("suffix <text>     - Sets temperature text suffix via USB-Serial.");
    Serial.println("echo <message>    - Prints <message> for testing via USB-Serial.");
    Serial.println("echon <number>    - Prints <number> for testing via USB-Serial.");
    Serial.println("simulate <on/off> - Enables or disables simulation mode (generates dummy data).");
    Serial.println("ip <address>      - Sets a static IP Address or displays IP Address if <address> is empty.");
    Serial.println("                  - e.g.) ip 192.168.0.1)");
    Serial.println("staip             - Displays STA IP Address.");
    Serial.println("ls                - Lists files and directories in LittleFS.");
    Serial.println("cat <file>        - Displays the contents of the specified file.");
    Serial.println("rm <file>         - Deletes the specified file.");
    Serial.println("usbserial <on/off>- Starts or stops JSON output {time, temp} via USB-Serial (Non-persistent) via USB-Serial.");
    Serial.println("start             - Starts measurement via USB-Serial.");
    Serial.println("stop              - Stops measurement via USB-Serial.");
    Serial.println("bpress <command>  - Registers <command> for button press.");
    Serial.println("blpress <command> - Registers <command> for button long press.");
    Serial.println("templed <on/off>  - Displays temperature using 3 sets of LED blinks.");
    Serial.println("                    Each digit (100s, 10s, 1s) is shown in sequence:");
    Serial.println("                    [Blink Lengths]");
    Serial.println("                    - 120ms (Short)  : Represents '1'");
    Serial.println("                    - 400ms (Medium) : Represents '5'");
    Serial.println("                    - 800ms (Long)   : Represents '0'");
    Serial.println("                    [How to Read Example: 128 degrees]");
    Serial.println("                    1st: 120ms(1) -> 2nd: 120msx2(2) -> 3rd: 400ms(5)+120msx3(3)");
    Serial.println("                    (There is a short pause between each digit.)");
    Serial.println("ipled <on/off>    - Displays STA IP Address using LED blinks.");
    Serial.println("                    Each octet is shown in sequence (Roman numeral style):");
    Serial.println("                    - 120ms (Short)  : Represents '1'");
    Serial.println("                    - 400ms (Medium) : Represents '5'");
    Serial.println("                    - 800ms (Long)   : Represents '0'");
    Serial.println("                    Long pause between octets.");
    Serial.println("wifiscan          - Scans for available WiFi networks.");
    Serial.println("status            - Displays UZU ROASTER status.");
    Serial.println("status -h         - Displays hardware status.");
    Serial.println("wifilog <on/off>  - Displays wifi system log.");
    Serial.println("wifimode <ap/sta> - changes WiFi mode(AP or STA) and restarts.");
    Serial.println("maxwifi <number>  - Sets maximum WiFi connection(AP mode).");
    Serial.println("help              - Displays this help menu.");
  }
  else {
      //Serial.println("Unknown command."); // "8t,gs" とかいうコマンドがArtisan（Behmor）から送られてきて反応するためコメントアウト
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

  xTaskCreateUniversal(TemperatureDisplayTask, "TEMPERATURE_LED", 4096, NULL, 5, NULL, 0);
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
  Serial.print("WiFi disconnected.\n");
  delay(100);
}

//////////////////////////////////////////////////////////////////////////
void WiFiSetup() {
  WiFi.onEvent(onWiFiEvent);
  preferences.begin("wifi", true); // 読み取り専用
  IPAddressMemory[0] = preferences.getInt("address0", IPAddressMemory[0]);
  IPAddressMemory[1] = preferences.getInt("address1", IPAddressMemory[1]);
  IPAddressMemory[2] = preferences.getInt("address2", IPAddressMemory[2]);
  IPAddressMemory[3] = preferences.getInt("address3", IPAddressMemory[3]);
  String ssid = preferences.getString("ssid", Ssid);
  String pass = preferences.getString("pass", Password);
  CurrentStaSsid = preferences.getString("stassid", StaSsid); 
  CurrentStaPassword = preferences.getString("stapass", StaPass);
  String wifimode = preferences.getString("wifimode", "ap");  // デフォルトはAP
  int max_wifi = preferences.getInt("maxwifi", MAX_WIFI_CONNECTION);
  preferences.end();

  ElegantOTA.begin(&ServerObject);  // 2026.2.23

  if (wifimode == "sta") {  // STA mode
    WiFi.mode(WIFI_STA);
    if (CurrentStaSsid != "") {
      WiFi.begin(CurrentStaSsid, CurrentStaPassword); 
      ServerObject.begin();  // ← 追加！
      webSocket.begin();     // ← 追加！
      webSocket.onEvent(onWebSocketEvent);
      webSocket.enableHeartbeat(10000, 3000, 3);
    }
  } else {  // AP mode
    WiFi.mode(WIFI_AP);
    IpAddress_ = IPAddress(IPAddressMemory[0], IPAddressMemory[1], IPAddressMemory[2], IPAddressMemory[3]);
    WiFi.softAPConfig(IpAddress_, IpAddress_, SubNet);
    WiFi.softAP(ssid, pass, 1, 0, max_wifi); 
  }

  WebSerial.begin(&ServerObject);
  WebSerial.onMessage(WebReceiveMsg);

  IPAddress my_ip = WiFi.softAPIP();
  Serial.print("IP address: ");
  Serial.println(my_ip.toString());
  Serial.print("SSID(AP): ");
  Serial.println(ssid);
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

  // ★ 追加：ファイルアップロード用管理画面
  ServerObject.on("/admin", HTTP_GET, [](AsyncWebServerRequest *request){
    String html = R"(
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>UZU ROASTER ファイル更新</title>
          <style>
              body { 
                  font-family: Arial, sans-serif; 
                  margin: 40px; 
                  background: #f5f5f5; 
              }
              .container { 
                  background: white; 
                  padding: 30px; 
                  border-radius: 10px; 
                  max-width: 600px; 
                  margin: 0 auto;
              }
              h1 { 
                  color: #333; 
                  border-bottom: 3px solid #ff6b35; 
                  padding-bottom: 10px; 
              }
              .warning { 
                  background: #fff3cd; 
                  border: 1px solid #ffeaa7; 
                  color: #856404; 
                  padding: 15px; 
                  border-radius: 5px; 
                  margin: 20px 0; 
              }
              .file-input { 
                  margin: 15px 0; 
                  padding: 10px; 
                  border: 2px dashed #ddd; 
                  border-radius: 5px; 
              }
              input[type="file"] { 
                  margin: 10px 0; 
              }
              input[type="submit"] { 
                  background: #666666; 
                  color: white; 
                  padding: 15px 30px; 
                  border: none; 
                  border-radius: 5px; 
                  font-size: 16px; 
                  cursor: pointer; 
                  margin-top: 20px; 
              }
              .info { 
                  background: #d1ecf1; 
                  border: 1px solid #bee5eb; 
                  color: #0c5460; 
                  padding: 15px; 
                  border-radius: 5px; 
                  margin: 20px 0; 
              }
              .hidden {
                  display: none;
              }
              .loading {
                  text-align: center;
                  padding: 50px;
              }
              .spinner {
                  border: 4px solid #f3f3f3;
                  border-top: 4px solid #ff6b35;
                  border-radius: 50%;
                  width: 60px;
                  height: 60px;
                  animation: spin 1s linear infinite;
                  margin: 0 auto 20px;
              }
              @keyframes spin {
                  0% { transform: rotate(0deg); }
                  100% { transform: rotate(360deg); }
              }
              .loading-text {
                  font-size: 18px;
                  color: #ff6b35;
                  font-weight: bold;
              }
          </style>
      </head>
      <body>
          <div class="container">
              <div id="upload-form">
                  <h1>🚀 UZU ROASTER ファイル更新</h1>
                  
                  <div class="warning">
                      <strong>⚠️ 重要な注意事項</strong><br>
                      • この機能はPCブラウザでのみご利用ください<br>
                      • ファイルアップロード後、UZU ROASTERを再起動し、再接続してください<br>
                      • アップロード中は電源を切らないでください
                  </div>
                  
                  <form action="/upload" method="POST" enctype="multipart/form-data" id="uploadForm">
                      <div class="file-input">
                          <label for="index"><strong>📄 index.html ファイル:</strong></label><br>
                          <input type="file" id="index" name="index" accept=".html">
                      </div>
                      
                      <div class="file-input">
                          <label for="script"><strong>📄 script.js ファイル:</strong></label><br>
                          <input type="file" id="script" name="script" accept=".js">
                      </div>
                      
                      <div class="file-input">
                          <label for="option"><strong>📄 オプション ファイル:</strong></label>（※管理パスワード必須）<br>
                          <input type="file" id="option" name="option" accept=".*" disabled><br>
                          <label for="passcode"><strong>管理パスワード:</strong></label><br>
                          <input type="password" id="passcode" name="passcode" maxlength="4"><br><br>
                      </div>                      
                      <input type="submit" value="🚀 アップロード開始" id="submitBtn">
                  </form>
                  <script>
                    const passcodeField = document.getElementById('passcode');
                    const optionFileField = document.getElementById('option');
                    const correctPasscode = '0277'; // ここに正しい暗証番号を設定してください

                    passcodeField.addEventListener('input', () => {
                      if (passcodeField.value === correctPasscode) {
                        optionFileField.disabled = false;
                        optionFileField.style.backgroundColor = ''; // 有効時の背景色をリセット
                        optionFileField.style.cursor = 'pointer'; // カーソルを通常に戻す
                      } else {
                        optionFileField.disabled = true;
                        optionFileField.style.backgroundColor = '#e9e9e9'; // 無効時の背景色
                        optionFileField.style.cursor = 'not-allowed'; // カーソルを無効に
                      }
                    });

                    // ページ読み込み時にファイル選択フィールドを無効化
                    document.addEventListener('DOMContentLoaded', () => {
                      optionFileField.disabled = true;
                      optionFileField.style.backgroundColor = '#e9e9e9';
                      optionFileField.style.cursor = 'not-allowed';
                    });
                  </script>
                  <script>
                    document.getElementById('index').addEventListener('change', (event) => {
                      const file = event.target.files[0];
                      if (file && file.name !== 'index.html') {
                        alert('ファイル名は index.html である必要があります。');
                        event.target.value = '';
                      }
                    });
                    document.getElementById('script').addEventListener('change', (event) => {
                      const file = event.target.files[0];
                      if (file && file.name !== 'script.js') {
                        alert('ファイル名は script.js である必要があります。');
                        event.target.value = '';
                      }
                    });
                  </script>
                  <div class="info">
                      <strong>📥 ファイルの入手方法:</strong><br>
                      1. <a href='https://github.com/uzuuzuhonpo/uzuroaster' target='_blank'>GitHub</a>から最新版をダウンロード<br>
                      ※index.htmlとscript.jsがバージョンアップ対象ファイルです。オプションでそれ以外の任意のファイルをアップロード可能です<br>
                      2. PCの任意のフォルダに保存<br>
                      3. 上記のフォームでファイルを選択してアップロード<br>
                      <strong>※選択していないファイルはバージョンアップされません</strong>
                  </div>
                  <p><a href="/">← メイン画面に戻る</a></p>
              </div>
              
              <div id="loading-screen" class="hidden">
                  <div class="loading">
                      <div class="spinner"></div>
                      <div class="loading-text">📤 アップロード中...</div>
                      <p>UZU ROASTERにファイルを送信しています。<br>
                      しばらくお待ちください。</p>
                      <div class="warning">
                          <strong>⚠️ 電源を切らないでください</strong>
                      </div>
                  </div>
              </div>
          </div>
          
          <script>
              document.getElementById('uploadForm').addEventListener('submit', function(e) {
                  // フォームを隠してローディング画面を表示
                  document.getElementById('upload-form').classList.add('hidden');
                  document.getElementById('loading-screen').classList.remove('hidden');
              });
          </script>
          <script>
            document.addEventListener('DOMContentLoaded', function() {
                const fileInputs = document.querySelectorAll('.file-input input[type="file"]');
                const submitBtn = document.getElementById('submitBtn');

                // 初回ロード時にボタンの状態を設定
                updateSubmitButtonState();

                // ファイル選択欄の変更を監視
                fileInputs.forEach(input => {
                    input.addEventListener('change', updateSubmitButtonState);
                });

                // ボタンの状態を更新する関数
                function updateSubmitButtonState() {
                    let hasFile = false;
                    fileInputs.forEach(input => {
                        if (input.files.length > 0) {
                            hasFile = true;
                        }
                    });
                    submitBtn.disabled = !hasFile;
                    if (hasFile == true) {
                      submitBtn.style.backgroundColor = '#ff6b35';
                    }
                    else {
                      submitBtn.style.backgroundColor = '#666666';
                    }
                }

                // フォーム送信時の処理（元々のコード）
                document.getElementById('uploadForm').addEventListener('submit', function(e) {
                    // フォームを隠してローディング画面を表示
                    document.getElementById('upload-form').classList.add('hidden');
                    document.getElementById('loading-screen').classList.remove('hidden');
                });
            });
        </script>

      </body>
      </html>
      )";

    request->send(200, "text/html", html);
  });

  // ★ 修正版：ファイルアップロード処理
  ServerObject.on("/upload", HTTP_POST, 
    // アップロード完了時の処理
    [](AsyncWebServerRequest *request) {

    String html = R"(
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>アップロード完了</title>
          <style>
              body { 
                  font-family: Arial, sans-serif; 
                  margin: 40px; 
                  text-align: center; 
                  background: #f5f5f5; 
              }
              .success { 
                  background: #d4edda; 
                  border: 1px solid #c3e6cb; 
                  color: #155724; 
                  padding: 40px; 
                  border-radius: 10px; 
                  max-width: 600px; 
                  margin: 0 auto; 
                  line-height: 1.6;
              }
              h1 { color: #155724; margin-bottom: 20px; }
              .step { 
                  background: #fff; 
                  padding: 15px; 
                  margin: 10px 0; 
                  border-radius: 5px; 
                  border-left: 4px solid #28a745; 
              }
              .important { 
                  background: #fff3cd; 
                  border: 1px solid #ffeaa7; 
                  color: #856404; 
                  padding: 15px; 
                  border-radius: 5px; 
                  margin: 20px 0; 
              }
          </style>
      </head>
      <body>
          <div class="success">
              <h1>✅ ファイルアップロード完了！</h1>
              
              <div class="important">
                  <strong>🔌 次の手順で UZU ROASTER を再起動してください</strong>
              </div>
              
              <div class="step">
                  <strong>手順1:</strong> UZU ROASTER本体の電源を一度切ってください
              </div>
              
              <div class="step">
                  <strong>手順2:</strong> 5秒ほど待機
              </div>
              
              <div class="step">
                  <strong>手順3:</strong> 電源を再度入れ直してください
              </div>
              
              <div class="step">
                  <strong>手順4:</strong> WiFi「UZU-ROASTER」に再接続
              </div>
              
              <div class="step">
                  <strong>手順5:</strong> ブラウザで UZU ROASTER URL（デフォルト：192.168.4.1） にアクセス
              </div>
              
              <p style="margin-top: 30px;">
                  <strong>✨ 新しいバージョンをお試しください</strong>
              </p>
              
              <p style="font-size: 14px; color: #666; margin-top: 20px;">
                  このページは電源を切るまでそのままにしておいてください
              </p>
          </div>
      </body>
      </html>
      )";
      
      request->send(200, "text/html; charset=UTF-8", html);
  },
    // アップロード処理中の処理
    [](AsyncWebServerRequest *request, String filename, size_t index, uint8_t *data, size_t len, bool final) {
      static File uploadFile;
      static String currentFilePath = "";
      
      // アップロード開始
      if (index == 0) {
        Serial.println("=== アップロード開始 ===");
        Serial.println("ファイル名: " + filename);
        currentFilePath = "/" + filename; // 現状はすべてのファイルがアップロード可能(フロントエンドで既に妥当性判断済み)
        
       
        Serial.println("保存先: " + currentFilePath);
        
        // 既存ファイルを削除してから新規作成
        if (LittleFS.exists(currentFilePath)) {
          LittleFS.remove(currentFilePath);
          Serial.println("既存ファイルを削除: " + currentFilePath);
        }
        
        uploadFile = LittleFS.open(currentFilePath, "w");
        if (!uploadFile) {
          Serial.println("ファイル作成に失敗: " + currentFilePath);
          return;
        }
        
        Serial.println("ファイル作成成功: " + currentFilePath);
      }
      
      // データ書き込み
      if (len && uploadFile) {
        size_t written = uploadFile.write(data, len);
        if (written != len) {
          Serial.println("書き込みエラー: " + String(written) + "/" + String(len));
        } else {
          Serial.println("書き込み中: " + String(len) + " bytes");
        }
      }
      
      // アップロード完了
      if (final) {
        if (uploadFile) {
          uploadFile.close();
          Serial.println("=== アップロード完了 ===");
          Serial.println("ファイル: " + filename);
          Serial.println("保存先: " + currentFilePath);
          Serial.println("総サイズ: " + String(index + len) + " bytes");
          
          // ファイルが正しく保存されたか確認
          if (LittleFS.exists(currentFilePath)) {
            File checkFile = LittleFS.open(currentFilePath, "r");
            if (checkFile) {
              Serial.println("保存確認OK: " + String(checkFile.size()) + " bytes");
              checkFile.close();
            }
          } else {
            Serial.println("保存確認NG: ファイルが見つからない");
          }
        }
        currentFilePath = "";
      }
    }
  );
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
            //Serial.println("AP Mode started.");
            webSocket.begin();
            webSocket.onEvent(onWebSocketEvent);
            webSocket.enableHeartbeat(10000, 3000, 3); // 2026.2.19 added 
            dnsServer.start(53, "*", IpAddress_);
            ServerObject.begin();
            //Serial.println("WebSocket server started.");
            break;

        case ARDUINO_EVENT_WIFI_AP_STACONNECTED:  // 2026.2.19 Separated 
            Serial.println("Client connected.");
            break;

        case ARDUINO_EVENT_WIFI_AP_STOP:  // ここには来ない。。。
            //Serial.println("AP Mode stopped.");
            webSocket.disconnect(); // 全クライアントを切断
            break;
        case ARDUINO_EVENT_WIFI_AP_STADISCONNECTED:
            int num = webSocket.connectedClients();
            Serial.print("Station or Client disconnected. Remaining: ");
            Serial.println(num);
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
    Serial.println("Couldn't detect sensor.");
  }
}

//////////////////////////////////////////////////////////////////////////
double ReadThermoCouple() {
   if (thermocouple.readError()) {
    //Serial.println("Thermocouple error!");
    return 0.0;
  }

  double temp = thermocouple.readCelsius();
  if (isnan(temp)) {
    //Serial.println("Fail to read sensor.");
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
        Serial.println("異常な温度値のため送信中止");
        return;
    }
    else if (AverageTemperature > 1200) AverageTemperature = 1200;  // 2026.02.18
    else if (AverageTemperature < 0) AverageTemperature = 0;

    StaticJsonDocument<128> json;
    json["time"] = time;
    json["temp"] = roundf(AverageTemperature * 10) / 10.0;;
    String message;
    message.reserve(64);
    serializeJson(json, message);
    if (UsbSerial) {
      Serial.println(message);
    }
    else {
      webSocket.broadcastTXT(message);
    }
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
    StaticJsonDocument<128> json;
    DeserializationError err = deserializeJson(json, payload);
    if (err) {
      Serial.println("JSON受信エラー");
      return;
    }
    const char* cmd = json["command"];
    const char* id = json["id"];  // ← クライアントから送られてきたid（任意）

    Serial.println(cmd); 
    if (cmd != nullptr) {
      String cmdStr = String(cmd); 
      CommandProcess(cmdStr); 
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
