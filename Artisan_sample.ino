#include <iostream>
#include <deque>
#include <esp_wifi.h>
#include <WiFi.h>
#include <WiFiGeneric.h>
#include <ESP32Servo.h>  
#include <FS.h>
#include <LittleFS.h>
#include <ESPAsyncWebServer.h>
#include <WebSocketsServer.h>
#include <DNSServer.h>
#include <SPI.h>
#include "Adafruit_MAX31855.h"
#include "esp_pm.h"
#include <Preferences.h> 
#include <WebSerial.h>
#include <deque>
#include <vector>
#include <algorithm>
#include <ArduinoJson.h>

#define MAX_ROAST_TIME  1800
#define MAX_TEMPERATURE 260
#define MAX_WIFI_CONNECTION   10

//////////////////////////////////////////////////////////////////////////
// Global Variables
//////////////////////////////////////////////////////////////////////////
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

int TemperatureInterval = 500; // [ms]
int TemperatureDigit = 1; // 小数桁
String Prefix = "";
String Suffix = "";
double SimulateCount = 0.0;
bool TempDisplay = true;
bool webSocketConnected = false;

unsigned long lastSendTime = 0;
bool roasting = false;
int roastTime = 0;
int counterx = 0;
double RoastData[MAX_ROAST_TIME];
int IPAddressMemory[4] = { 192, 168, 4, 1 };  // デフォルトのUZU ROASTER IPアドレス
// 🔑 Wi-Fi設定
const char Ssid[] = "UZU-ROASTER";
const char Password[] = "";
IPAddress IpAddress_; 	// 後で設定可能
const IPAddress SubNet(255, 255, 255, 0); 	
bool UsbSerial = false;

// センサーオブジェクト作成
Adafruit_MAX31855 thermocouple(ThermoCLK_pin, ThermoCS_pin, ThermoDO_pin);
double AverageTemperature = 0.0;
double ProfileTemperature = 0.0;
const String TemperaturePath = "temperature";

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

    //ProfileTemperature = getTargetTemp(roastTime);
    ProfileTemperature = 0;
    double diff = AverageTemperature - ProfileTemperature;

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
  esp_pm_config_esp32_t pm_config = {
    .max_freq_mhz = 240,
    .min_freq_mhz = 80,
    .light_sleep_enable = true
  };
}

//////////////////////////////////////////////////////////////////////////
void IOSetup() {
  pinMode(bootButtonPin, INPUT_PULLUP);  // BOOTボタンはプルアップで使う
  pinMode(2, OUTPUT);  // D2(オンLED) GPIO2 = 出力に設定
}

//////////////////////////////////////////////////////////////////////////
void setup() {

  LowEnergySetUp();
  SerialSetup();

  if (!LittleFS.begin()) {
    Serial.println("LittleFSマウント失敗");
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
   
}
  
//////////////////////////////////////////////////////////////////////////
void ControlLED(bool onoff){
  if (onoff) {
    digitalWrite(2, HIGH);  // LED ON（点灯）
  }
  else {
    digitalWrite(2, LOW);  // LED ON（点灯）
  }
}

//////////////////////////////////////////////////////////////////////////
void loop() {
  PollSerial();
  webSocket.loop();

  delay(10);
  counterx++;

  LEDProc();
  readBootButton();

  if ((counterx % 300) == 0) {
    sendMessage("KEEP_ALIVE");  // 3秒毎にキープアライブを送信
  }
}

int LongButtonCount = 0;

void readBootButton() {
  bool State = digitalRead(bootButtonPin); // false: ON / true: OFF
  if (State == false) {
    LongButtonCount++;
      if (LongButtonCount == 300) { 
      preferences.begin("function");
      String command = preferences.getString("blpress", "");
      preferences.end();
      CommandProcess(command);
      LongButtonCount = 301; 
      Serial.println(String("Button long press command: ") + command);
    }
  } 
  else {
    if (LongButtonCount > 3 && LongButtonCount < 300) {
      // 3カウント〜3秒未満なら「シングルプッシュ」
      preferences.begin("function");
      String command = preferences.getString("bpress", "");
      preferences.end();
      CommandProcess(command);
      Serial.println(String("Button press command: ") + command);
    }
    // 離したらリセット
    LongButtonCount = 0;
  }
}

//////////////////////////////////////////////////////////////////////////
void LEDProc() {
  if (roasting == true) {
    if ((counterx % 16) == 0) {
      ControlLED(true);
    }
    else if ((counterx % 8) == 0) {
      ControlLED(false);
    }
  }
  else if (webSocketConnected || UsbSerial) {
     if ((counterx % 150) == 0) {
      ControlLED(true);
    }
    else if ((counterx % 75) == 0) {
      ControlLED(false);
    }
  }
  else {
      ControlLED(false);
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
      IPAddressMemory[0] = 192;
      IPAddressMemory[1] = 168;
      IPAddressMemory[2] = 4;
      IPAddressMemory[3] = 1;
      preferences.putInt("address0", IPAddressMemory[0]);
      preferences.putInt("address1", IPAddressMemory[1]);
      preferences.putInt("address2", IPAddressMemory[2]);
      preferences.putInt("address3", IPAddressMemory[3]);
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

      preferences.begin("temperature", false);
      preferences.putString("bpress", "");
      preferences.putString("blpress", "");
      preferences.end();
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
  else if (command == "password") {
    String newPass = "";
    Serial.println("Password: No Password");
    preferences.begin("wifi", false);
    preferences.putString("pass", newPass);
    preferences.end();
    ESP.restart();
  }
  else if (command.startsWith("ssid ")) {
    String newSsid = command.substring(5);
    Serial.println("SSID: " + newSsid);
    preferences.begin("wifi", false);
    preferences.putString("ssid", newSsid);
    preferences.end();
    ESP.restart();
  }
  else if (command.startsWith("password ")) {
    String newPass = command.substring(9);
    Serial.println("Password: " + newPass);
    preferences.begin("wifi", false);
    preferences.putString("pass", newPass);
    preferences.end();
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
  else if (command == "ls") {
    if (!LittleFS.begin()) {
      Serial.println("LittleFS mount failed!");
      return;
    }
    Serial.println("LittleFS File List:");
    listDir(LittleFS, "/", 1); // 再帰深さは1で十分ずら
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
  }
  else if (command == "blpress") {
    preferences.begin("function", false);
    preferences.putString("blpress", "");
    preferences.end();
    Serial.println(String("Button long press command reset."));
  }
  else if (command.startsWith("bpress ")) {
    str = command.substring(7);
    preferences.begin("function", false);
    preferences.putString("bpress", str);
    preferences.end();
    Serial.println(String("Button press command: ") + str);
  }
  else if (command.startsWith("blpress ")) {
    str = command.substring(8);
    preferences.begin("function", false);
    preferences.putString("blpress", str);
    preferences.end();
    Serial.println(String("Button long ress command: ") + str);
  }
  else if (command == "help") {
    Serial.println("Available commands:");
    Serial.println("reset       - Resets the system and restores settings.");
    Serial.println("reset all   - Resets for factory settings.");
    Serial.println("wifi on     - Turns on WiFi.");
    Serial.println("wifi off    - Turns off WiFi.");
    Serial.println("ssid        - Shows the current SSID or sets the one.");
    Serial.println("password    - Clears the WiFi password or sets the one.");
    Serial.println("temp on     - Turns on temperature display.");
    Serial.println("temp off    - Turns off temperature display.");
    Serial.println("interval    - Sets temperature display interval[ms].");
    Serial.println("digit       - Sets temperature fraction digit[0-2].");
    Serial.println("prefix      - Sets temperature text prefix.");
    Serial.println("suffix      - Sets temperature text suffix.");
    Serial.println("echo        - Prints the message.");
    Serial.println("echon       - Prints the number.");
    Serial.println("simulate on - Turns on simulation mode.");
    Serial.println("simulate off - Turns off simulation mode.");
    Serial.println("ip          - Sets IP Address ex) ip 192.168.0.1");
    Serial.println("ls          - Lists files in LittleFS.");
    Serial.println("cat <file>  - Displays the contents of a file.");
    Serial.println("rm <file>   - Deletes a file.");
    Serial.println("usbserial on - Send time and temperature via USB-Serial(Temporary).");
    Serial.println("usbserial off - Send time only via USB-Serial.");
    Serial.println("start       - Start measurement via USB-Serial.");
    Serial.println("stop        - Stop measurement via USB-Serial.");
    Serial.println("bpress      - Register button press command.");
    Serial.println("blpress     - Register button long press command.");
    Serial.println("help        - Displays this help menu.");
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
  // Wi-Fiイベントハンドラの登録
  WiFi.onEvent(onWiFiEvent);
  
  WiFi.mode(WIFI_AP); 
  preferences.begin("wifi", true); // 読み取り専用
  IPAddressMemory[0] = preferences.getInt("address0", IPAddressMemory[0]);
  IPAddressMemory[1] = preferences.getInt("address1", IPAddressMemory[1]);
  IPAddressMemory[2] = preferences.getInt("address2", IPAddressMemory[2]);
  IPAddressMemory[3] = preferences.getInt("address3", IPAddressMemory[3]);
  preferences.end();

  IpAddress_ = IPAddress(IPAddressMemory[0], IPAddressMemory[1], IPAddressMemory[2], IPAddressMemory[3]);
  WiFi.softAPConfig(IpAddress_, IpAddress_, SubNet);
  delay(100);
  
  WebSerial.begin(&ServerObject);
  WebSerial.onMessage(WebReceiveMsg);

  preferences.begin("wifi", true); // 読み取り専用
  String ssid = preferences.getString("ssid", Ssid);
  String pass = preferences.getString("pass", Password);
  preferences.end();

  WiFi.softAP(ssid, pass, 1, 0, MAX_WIFI_CONNECTION); 
  
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
  /*
  ServerObject.on("/redirect", HTTP_GET, [](AsyncWebServerRequest *request){
    String ip = String(IPAddressMemory[0]) + "." + String(IPAddressMemory[1]) + "." + String(IPAddressMemory[2]) + "." + String(IPAddressMemory[3]);
    request->redirect(ip);
  });
  */
  /*
  ServerObject.on("/hotspot-detect.html", HTTP_GET, [](AsyncWebServerRequest *req){
    String ip = String(IPAddressMemory[0]) + "." + String(IPAddressMemory[1]) + "." + String(IPAddressMemory[2]) + "." + String(IPAddressMemory[3]);
    request->redirect(ip);
  });
  */
  /*
  ServerObject.on("/ncsi.txt", HTTP_GET, [](AsyncWebServerRequest *req){
    String ip = String(IPAddressMemory[0]) + "." + String(IPAddressMemory[1]) + "." + String(IPAddressMemory[2]) + "." + String(IPAddressMemory[3]);
    request->redirect(ip);
  }); 
  ServerObject.onNotFound([](AsyncWebServerRequest *request){
    ///request->send(404, "text/plain", "Not Found");
    String ip = String(IPAddressMemory[0]) + "." + String(IPAddressMemory[1]) + "." + String(IPAddressMemory[2]) + "." + String(IPAddressMemory[3]);
    request->redirect(ip);
  });
  */

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
        
      /*
        if (filename.indexOf("index.html") >= 0) {
          currentFilePath = "/index.html";
        } else if (filename.indexOf("script.js") >= 0) {
          currentFilePath = "/script.js";
        } else if (true) {
          currentFilePath = "/" + filename; 
        } else {
          Serial.println("Unknown file: " + filename);
          return;
        }
        */
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
        case ARDUINO_EVENT_WIFI_AP_STACONNECTED:
            //Serial.println("AP Mode started.");

            webSocket.begin();
            webSocket.onEvent(onWebSocketEvent);
            dnsServer.start(53, "*", IpAddress_);

            ServerObject.begin();

            //Serial.println("WebSocket server started.");
            break;
        case ARDUINO_EVENT_WIFI_AP_STOP:  // ここには来ない。。。
            //Serial.println("AP Mode stopped.");
            webSocket.disconnect(); // 全クライアントを切断
            //Serial.println("WebSocket server stopped.");
            break;
        case ARDUINO_EVENT_WIFI_AP_STADISCONNECTED:
            //Serial.println("Station disconnected from AP.");
            ESP.restart();  //ゴミを残して重くならないため強制的にリスタート
            
            webSocket.disconnect(); // 全クライアントを切断
            webSocket.close();
            delay(100); 
            dnsServer.stop();
            ServerObject.end();
            WiFi.disconnect(true);
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

double lastValidTemp = 20.0; // 前回の正常値を保存
int tempErrorCount = 0;
const double DEVIATION_TEMP = 10.0;
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

    StaticJsonDocument<128> json;
    json["time"] = time;
    json["temp"] = roundf(AverageTemperature * 10) / 10.0;;
    json["temp_prof"] = roundf(ProfileTemperature * 10) / 10.0;

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


    // if (strcmp(cmd, "start") == 0) {
    //   roasting = true;
    //   roastTime = 0;

    //   // ★ ACKレスポンスを作って返す
    //   StaticJsonDocument<256> ack;
    //   ack["type"] = "ack";
    //   ack["status"] = "ok";
    //   ack["id"] = id;  
    //   ack["message"] = "Roasting started";

    //   String response;
    //   serializeJson(ack, response);
    //   webSocket.sendTXT(num, response);
    // }
    // else if (strcmp(cmd, "stop") == 0) {
    //   roasting = false;
    //   Serial.println("焙煎ストップ受信");
    //   StaticJsonDocument<256> ack;
    //   ack["type"] = "ack";
    //   ack["status"] = "ok";
    //   ack["id"] = id;
    //   ack["message"] = "Roasting stopped";

    //   String response;
    //   serializeJson(ack, response);
    //   webSocket.sendTXT(num, response);
    // }
    // else if (strcmp(cmd, "reset") == 0) {
    //   Serial.println("リセット受信"); // リセットはACKを返さない
    //   ESP.restart();
    // }
    // else {  // シリアルコマンド実行
    //   //handleWebSocketMessage(num, payload, length);
    // }
  }
}

// void handleWebSocketMessage(uint8_t num, uint8_t *payload, size_t length) {
//   Serial.printf("空きヒープ: %d bytes\n", ESP.getFreeHeap());

//   DynamicJsonDocument doc(20000);  // 1バッチ分だけ確保
//   DeserializationError error = deserializeJson(doc, payload);
//   if (error) {
//     Serial.println("JSONエラー: ");
//     Serial.println(error.f_str());
//     return;
//   }

//   const char* id = doc["id"];
//   const char* type = doc["type"];

//   if (strcmp(type, "profile_upload_batch") == 0) {
//     int part = doc["part"];
//     bool isLast = doc["isLast"];
//     JsonArray profileArray = doc["profile"].as<JsonArray>();

//     if (part == 0) roastProfile.clear();  // 最初のバッチだけクリア

//     for (JsonObject point : profileArray) {
//       double time = point["x"];
//       double temp = point["y"];
//       roastProfile.emplace_back(time, temp);
//     }

//     // バッチごとのACK送信
//     StaticJsonDocument<256> ack;
//     ack["type"] = "ack";
//     ack["status"] = "ok";
//     ack["id"] = String(id) + "_" + String(part);
//     ack["message"] = "Batch received";
//     String response;
//     serializeJson(ack, response);
//     webSocket.sendTXT(num, response);

//     if (isLast) {
//       Serial.println("プロファイル全体受信完了！");
//       for (auto& pt : roastProfile) {
//         Serial.printf("t=%.1f, temp=%.1f\n", pt.first, pt.second);
//       }
//     }
//   }
// }

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
