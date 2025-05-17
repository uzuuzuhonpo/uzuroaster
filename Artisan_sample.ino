#include <iostream>
#include <deque>
#include <esp_wifi.h>
#include <WiFi.h>
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
#define MAX_TEMPERATURE 300

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
std::vector<std::pair<float, float>> roastProfile;

int TemperatureInterval = 500; // [ms]
int TemperatureDigit = 1; // 小数桁
String Prefix = "";
String Suffix = "";
float SimulateCount = 0.0;
bool TempDisplay = true;
bool webSocketConnected = false;

unsigned long lastSendTime = 0;
bool roasting = false;
int roastTime = 0;
int counterx = 0;
float RoastData[MAX_ROAST_TIME];

// 🔑 Wi-Fi設定
const char Ssid[] = "UZU-ROASTER";
const char Password[] = "00000000";
const IPAddress IpAddress_(192, 168, 4, 1); 	// *** set any addr ***
const IPAddress SubNet(255, 255, 255, 0); 	// *** set any addr ***

// センサーオブジェクト作成
Adafruit_MAX31855 thermocouple(ThermoCLK_pin, ThermoCS_pin, ThermoDO_pin);
float AverageTemperature = 0.0;
const String TemperaturePath = "temperature";

//////////////////////////////////////////////////////////////////////////
class MovingAverage {
private:
    std::deque<float> window;
    int windowSize;
    int trimSize;  // 除外する最大・最小の数（両方とも）
    
public:
    // コンストラクタ：ウィンドウサイズと除外数を指定
    MovingAverage(int size, int trim) : windowSize(size), trimSize(trim) {}

    float addValue(float value) {
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
        std::vector<float> sorted(window.begin(), window.end());
        std::sort(sorted.begin(), sorted.end());

        // 最大と最小を除いた範囲で平均を取る
        float sum = 0.0;
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
  const TickType_t delay = pdMS_TO_TICKS(100); // 100ms
  int ss = 1;
  int mm = 0; 
  float bt;
  enum ThermoMeterType { 
    TC4 = 0,
    Behmor,
    THERMO_MAX
  };
  ThermoMeterType thermo = Behmor;

  float avg;
  MovingAverage ma(10, 2);  // 10個の値で移動平均を計算
  int count = 0;

  while (true) {
    bt = ReadThermoCouple();
    avg = ma.addValue(bt);

    if (SimulateCount > 0.5) {
      avg = SimulateCount;
      SimulateCount += 0.1;
      if (SimulateCount > 240.0) SimulateCount = 1.0;
    }

    AverageTemperature = avg; // 移動平均化処理された温度をグローバルに保存
    if (AverageTemperature > MAX_TEMPERATURE) {AverageTemperature = MAX_TEMPERATURE;}
    else if (AverageTemperature < 0.0) {AverageTemperature = 0.0;}

    if (++count >= (TemperatureInterval / 100)) {
      count = 0;
      text = String(avg, TemperatureDigit);

      if (TempDisplay) {
        String result = Prefix + text + Suffix;
        Serial.println(result);
      }
    }

    if (roasting && roasting < MAX_ROAST_TIME) {
      roastTime += 1;
      RoastData[roastTime] = AverageTemperature;
      SendTemperatureData();

    }
  }


    vTaskDelay(delay); // FreeRTOS流のdelay
  }
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
  setCpuFrequencyMhz(80); // デフォルト240MHz → 80MHzに落とす
  // 電力管理（Power Management）を有効にして、アイドル時はLight Sleepに入るように設定
  esp_pm_config_esp32_t pm_config = {
    .max_freq_mhz = 80,
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
  ServerObject.onNotFound([](AsyncWebServerRequest *request){
    request->redirect("/");
  });

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
  bool currentButtonState = digitalRead(bootButtonPin);


  if ((counterx % 100) == 0 && currentButtonState == false) {
    Serial.println("Button pushed!!");
  }
}

//////////////////////////////////////////////////////////////////////////
float getTargetTemp(float t, const std::vector<std::pair<float, float>>& roastProfile) {
  if (roastProfile.empty()) return 0.0f;

  // 最初より前：先頭の温度を返す
  if (t <= roastProfile.front().first) {
    return roastProfile.front().second;
  }

  // 最後より後：末尾の温度を返す
  if (t >= roastProfile.back().first) {
    return roastProfile.back().second;
  }

  // 中間：線形補間
  for (size_t i = 1; i < roastProfile.size(); ++i) {
    float t0 = roastProfile[i - 1].first;
    float t1 = roastProfile[i].first;
    float temp0 = roastProfile[i - 1].second;
    float temp1 = roastProfile[i].second;

    if (t >= t0 && t <= t1) {
      float ratio = (t - t0) / (t1 - t0);
      return temp0 + ratio * (temp1 - temp0);
    }
  }

  // ここには来ないはずだが、念のため
  return 0.0f;
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
  else if (webSocketConnected == true) {
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

  if (command == "reset") {
    preferences.begin("wifi", false);
    preferences.putString("ssid", Ssid);
    preferences.putString("pass", Password);
    preferences.end();
    Serial.println(String("SSID: ") + Ssid);
    Serial.println(String("Password: ") + Password);

    int interval = 500;
    int digit = 1;
    String prefix = "";
    String suffix = "";
    bool temp_display = true;
    preferences.begin("temperature", false);
    preferences.putInt("interval", interval);
    preferences.putInt("digit", digit);
    preferences.putString("prefix", prefix);
    preferences.putString("suffix", suffix);
    preferences.putBool("temp_display", temp_display);
    preferences.end();

    Serial.println("Temperature interval: " + String(interval) + "[ms]");
    Serial.println("Temperature fraction digit: " + String(digit) + "[ms]");
    Serial.println("Removed prefix and suffix.");
    Serial.println("Temperature Display: ON");
    Serial.println("Resetting Uzu Roaster System...");

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
    float temp = str.toFloat();         // 数値として取り出す
    Serial.println(temp);               // 数値だけ送る
  }
  else if (command == "simulate on") {
    SimulateCount = 1.0;
    Serial.println("Simulate set to ON.");
  }
  else if (command == "simulate off") {
    SimulateCount = 0.0;
    Serial.println("Simulate set to OFF.");
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
 else if (command == "help") {
    Serial.println("Available commands:");
    Serial.println("reset       - Resets the system and restores settings.");
    Serial.println("wifi on     - Turns on WiFi.");
    Serial.println("wifi off    - Turns off WiFi.");
    Serial.println("ssid        - Shows the current SSID or sets the one.");
    Serial.println("password    - Clears the WiFi password or sets the one.");
    Serial.println("temp on     - Turns on temperature display.");
    Serial.println("temp off    - Turns off temperature display.");
    Serial.println("interval    - Set temperature display interval.");
    Serial.println("digit       - Set temperature fraction digit.");
    Serial.println("prefix      - Set temperature text prefix.");
    Serial.println("suffix      - Set temperature text suffix.");
    Serial.println("echo        - Prints the message.");
    Serial.println("echon       - Prints the number.");
    Serial.println("simulate on - Turns on simulation mode.");
    Serial.println("simulate off- Turns off simulation mode.");
    Serial.println("ls          - List files in LittleFS.");
    Serial.println("cat <file>  - Display the contents of a file.");
    Serial.println("rm <file>   - Delete a file.");
    Serial.println("help        - Display this help menu.");
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
    2048,           // スタックサイズ（バイト）
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
  WiFi.mode(WIFI_AP); 
  WiFi.softAPConfig(IpAddress_, IpAddress_, SubNet);
  delay(100);
  
  preferences.begin("wifi", true); // 読み取り専用
  String ssid = preferences.getString("ssid", Ssid);
  String pass = preferences.getString("pass", Password);
  preferences.end();

  WiFi.softAP(ssid, pass);
  delay(100);
  
  IPAddress my_ip = WiFi.softAPIP();
 
  Serial.print("IP address: ");
  Serial.println(my_ip.toString());
  Serial.print("SSID(AP): ");
  Serial.println(ssid);
  
  WebSerial.begin(&ServerObject);
  WebSerial.onMessage(WebReceiveMsg);
  ServerObject.begin();
  
  webSocket.begin();
  webSocket.onEvent(onWebSocketEvent);

// ３）DNSサーバー起動（全ドメインを local_ip に向ける）
  dnsServer.start(53, "*", IpAddress_);
   // エンドポイント登録（非同期の形式）
   String path = "/" + TemperaturePath;
  ServerObject.on(path.c_str(), HTTP_GET, [](AsyncWebServerRequest *request){
    float c = AverageTemperature;
    String json = "{\"temperature\": " + String(c) + "}";
    request->send(200, "application/json", json);
  });
  ServerObject.begin();

  // 192.168.4.1/がリクエストされた時に返すWebサーバー設定
  ServerObject.on("/", HTTP_GET, [](AsyncWebServerRequest *req){
    req->send(LittleFS, "/index.html", "text/html");
  });
  
  ServerObject.on("/generate_204", HTTP_GET, [](AsyncWebServerRequest *request){
    request->redirect("http://192.168.4.1/");
  });
  /*
  ServerObject.on("/redirect", HTTP_GET, [](AsyncWebServerRequest *request){
    request->redirect("http://192.168.4.1/");
  });
  */
  ServerObject.on("/hotspot-detect.html", HTTP_GET, [](AsyncWebServerRequest *req){
    req->redirect("http://192.168.4.1/");
  });
  /*
    ServerObject.on("/webserial", HTTP_GET, [](AsyncWebServerRequest *req){
    req->send(LittleFS, "/webserial.html", "text/html");
  });
  ServerObject.on("/ncsi.txt", HTTP_GET, [](AsyncWebServerRequest *req){
    req->redirect("http://192.168.4.1/");
  }); 
  ServerObject.onNotFound([](AsyncWebServerRequest *request){
    ///request->send(404, "text/plain", "Not Found");
    request->redirect("http://192.168.4.1/");
  });
  */
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
float ReadThermoCouple() {
   if (thermocouple.readError()) {
    //Serial.println("Thermocouple error!");
    return 0.0;
  }

  float temp = thermocouple.readCelsius();
  if (isnan(temp)) {
    //Serial.println("Fail to read sensor.");
  }
  
  return temp;
}

//////////////////////////////////////////////////////////////////////////
void SendTemperatureData() {
    float temp = SimulateCount;

    StaticJsonDocument<128> json;
    json["time"] = roastTime;
    json["temp"] = temp;
    
    String message;
    serializeJson(json, message);
    webSocket.broadcastTXT(message);
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

    if (strcmp(cmd, "start") == 0) {
      roasting = true;
      roastTime = 0;
      Serial.println("焙煎スタート受信");

      // ★ ACKレスポンスを作って返すずら
      StaticJsonDocument<256> ack;
      ack["type"] = "ack";
      ack["status"] = "ok";
      ack["id"] = id;  
      ack["message"] = "Roasting started";

      String response;
      serializeJson(ack, response);
      webSocket.sendTXT(num, response);
    }
    else if (strcmp(cmd, "stop") == 0) {
      roasting = false;
      Serial.println("焙煎ストップ受信");

      StaticJsonDocument<256> ack;
      ack["type"] = "ack";
      ack["status"] = "ok";
      ack["id"] = id;
      ack["message"] = "Roasting stopped";

      String response;
      serializeJson(ack, response);
      webSocket.sendTXT(num, response);
    }
    else {
      handleWebSocketMessage(num, payload, length);
    }
  }
}

//////////////////////////////////////////////////////////////////////////
void handleWebSocketMessage(uint8_t num, uint8_t *payload, size_t length) {
  DynamicJsonDocument doc(60000); // 焙煎プロファイル分
  DeserializationError error = deserializeJson(doc, payload);
  const char* id = doc["id"];

  if (error) {
    Serial.println("JSONデコードエラー");
    return;
  }

  const char* type = doc["type"];
  if (strcmp(type, "profile_upload") == 0) {
    JsonArray profileArray = doc["profile"].as<JsonArray>();
    roastProfile.clear();  // いったんクリア

    for (JsonObject point : profileArray) {
      float time = point["x"];
      float temp = point["y"];
      roastProfile.emplace_back(time, temp);
    }

    // 保存されたプロファイルを確認
    Serial.println("プロファイルを受信:");
    for (auto& pt : roastProfile) {
      Serial.printf("  t=%.1f, temp=%.1f\n", pt.first, pt.second);
    }

      StaticJsonDocument<256> ack;
      ack["type"] = "ack";
      ack["status"] = "ok";
      ack["id"] = id;
      ack["message"] = "Profile uploaded";

      String response;
      serializeJson(ack, response);
      webSocket.sendTXT(num, response);
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
