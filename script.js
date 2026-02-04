const textarea = document.getElementById('profileMemo');
const popup = document.getElementById('popupTextarea');
const popupText = document.getElementById('popupText');
const closeButton = document.getElementById('closePopup');

const unit_temp = "<span class='unit_temp unit_generic'>[℃]</span>";
const unit_ror = "<span class='unit_ror unit_generic'>[℃/分]</span>";
const unit_sec = "<span class='unit_sec unit_generic'>[秒]</span>";

const UzuRoasterVersionStr = "1.0.0";
const UzuRoasterControllerVersionStr = "1.0.0";
let roastChart = null;
const profile_color = 'rgba(80,80,80,0.4)'; // プロファイルの色 
const active_profile_color = 'rgba(136, 184, 221, 0.8)'; // アクティブプロファイルの色  
let isMinutesSecondsFormat = false; // 初期値は秒表示
let widthOffset = 0; // グラフの幅調整用オフセット
let maxChartWidth = 1800; // グラフの最大幅
let ProfileSecondData = []; // 1秒間隔のプロファイルデータ
const Version = "UZU ROASTER     Ver. 1.0.0\n\n OKを押すと新しいタブでマニュアルが開きます"
      + "\n"; // バージョン情報
window.addEventListener('resize', () => {
  if (roastChart) {
    updateScreen();
    resizeOverlayCanvas();
  }
});

////////////////////////////////////////////////////////////////
// Pythonからの呼び出し用関数
////////////////////////////////////////////////////////////////
window.updateFromPython = function(data) {
  try {
      // もしdataが文字列ならパース（念のため）
      const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
      updateConnectionStatus(true); // USBシリアルからデータがあれば接続中というテイ
      receiveWebMessage(parsedData);
      console.log(parsedData);
      
  } catch (e) {
      console.error("❌ JS側エラー:", e.message);
  }
};

// --- カラーモード管理 ---
// ① ページ読み込み時に自動で呼ぶ初期化関数
function initColorMode() {  
    // 保存されたモードを読み込む（なければ '0'）
    const savedMode = localStorage.getItem('uzu_color_mode') || '0';
    changeColorMode(parseInt(savedMode), false); 
}

// ② カラーモード切り替え（isSaveは保存するかどうかのフラグ）
function changeColorMode(modeNum, isSave = true) {
    // クラスの付け替え
    for (let i = 1; i <= 6; i++) {
        document.body.classList.remove('mode' + i);
    }
    
    if (modeNum >= 1 && modeNum <= 6) {
        document.body.classList.add('mode' + modeNum);
    }

    // ③ ストレージに保存（初期化時は保存しなくていいので判定を入れる）
    if (isSave) {
        localStorage.setItem('uzu_color_mode', modeNum);
    }
}

////////////////////////////////////////////////////////////////
// グラフのクリックで全画面表示切り替え
////////////////////////////////////////////////////////////////
let isFullscreen = false;
const chartCanvas = document.getElementById('chart-section');
const mainArea2 = document.getElementById('main-area2');

chartCanvas.addEventListener('click', () => {
  if (!isFullscreen) {
    animateFromElement(chartCanvas); // アニメーションを適用
    document.getElementById('table_contents').style.display="none";
    chartCanvas.style.position = "fixed";
    chartCanvas.style.width = "100%";
    chartCanvas.style.height = "100%";  
    chartCanvas.style.top = "0";
    chartCanvas.style.left = "0";
    chartCanvas.style.zIndex = "1000"; // 他の要素の上に表示
    chartCanvas.style.backgroundColor = "white"; // 背景色を白に設定
    chartCanvas.style.display = "block"; // ブロック要素として表示
    isFullscreen = true;
  } 
  else {
    document.getElementById('table_contents').style.display="flex";
    chartCanvas.style.position = "relative";
    isFullscreen = false;
  }
  mainAreaResize(mainArea2);
  animateToElement(chartCanvas); // アニメーションを適用
});

function updateScreen() {
  const mainArea2 = document.getElementById('main-area2');
  mainAreaResize(mainArea2);
  roastChart.resize();
}

////////////////////////////////////////////////////////////////
// シンプルボーダー拡大アニメーション
////////////////////////////////////////////////////////////////
function animateFromElement(element) {
    // 要素の位置とサイズを取得
    const rect = element.getBoundingClientRect();
    const scrollX = window.pageXOffset;
    const scrollY = window.pageYOffset;

    // アニメーション用のボーダー要素を作成
    const border = document.createElement('div');
    border.style.cssText = `
        position: fixed;
        pointer-events: none;
        border: 4px solid #565656ff;
        border-radius: 10px;
        z-index: 1999;
        box-sizing: border-box;
        width: ${rect.width}px;
        height: ${rect.height}px;
        left: ${rect.left}px;
        top: ${rect.top}px;
        transition: all 200ms ease-out, opacity 500ms ease-out;
        opacity: 1;
    `;

    // DOMに追加
    document.body.appendChild(border);

    // 次のフレームでアニメーション開始
    requestAnimationFrame(() => {
        // フルスクリーンサイズに拡大
        const fullWidth = window.innerWidth;
        const fullHeight = window.innerHeight;
        
        border.style.width = fullWidth + 'px';
        border.style.height = fullHeight + 'px';
        border.style.left = '0px';
        border.style.top = '0px';
        border.style.opacity = '0';

        // アニメーション完了後に削除
        setTimeout(() => {
            border.remove();
        }, 800);
    });
}

////////////////////////////////////////////////////////////////
// シンプルボーダー縮小アニメーション（フルスクリーン→要素サイズ）
////////////////////////////////////////////////////////////////
function animateToElement(element) {
    // 要素の位置とサイズを取得
    const rect = element.getBoundingClientRect();
    const scrollX = window.pageXOffset;
    const scrollY = window.pageYOffset;

    // フルスクリーンサイズを取得
    const fullWidth = window.innerWidth;
    const fullHeight = window.innerHeight;

    // アニメーション用のボーダー要素を作成
    const border = document.createElement('div');
    border.style.cssText = `
        position: fixed;
        pointer-events: none;
        border: 4px solid #565656ff;
        border-radius: 0px;
        z-index: 1999;
        box-sizing: border-box;
        width: ${fullWidth}px;
        height: ${fullHeight}px;
        left: 0px;
        top: 0px; 
        transition: all 200ms ease-out, opacity 500ms ease-out;
        opacity: 1;
    `;

    // DOMに追加
    document.body.appendChild(border);

    // 次のフレームでアニメーション開始
    requestAnimationFrame(() => {
        // 要素サイズに縮小
        border.style.width = rect.width + 'px';
        border.style.height = rect.height + 'px';
        border.style.left = rect.left + 'px';
        border.style.top = rect.top + 'px';
        border.style.borderRadius = '10px';
        border.style.opacity = '0';

        // アニメーション完了後に削除
        setTimeout(() => {
            border.remove();
        }, 800);
    });
}

////////////////////////////////////////////////////////////////
// グラフの高さをビューポートに合わせて調整
////////////////////////////////////////////////////////////////
function adjustHeightToViewport(selector) {
  const element = document.querySelector(selector);
  if (!element) return;

  // 初回実行 & リサイズ時に再実行
  mainAreaResize(element);
  window.addEventListener('resize', mainAreaResize(element));
}

function mainAreaResize(element) {
  const viewportHeight = window.innerHeight;
  const elementTop = element.getBoundingClientRect().top + window.scrollY;
  const newHeight = viewportHeight - elementTop - 10;
  element.style.height = newHeight + 'px';
  setMobileWidthIfMobile(element); // スマホ判定で要素幅を100%に設定
}

adjustHeightToViewport('#main-area2');

////////////////////////////////////////////////////////////////
// スマホ判定と要素幅設定
////////////////////////////////////////////////////////////////
// ===== メイン関数: スマホ判定で要素幅を100%に設定 =====
function setMobileWidthIfMobile(element) {
    if (isMobile()) {
      element.style.width = '100vw';
      return true;
    }
    return false;
}

// ===== スマホ判定関数 =====
function isMobile() {
    // 方法1: 画面幅での判定 (768px以下をモバイルとする)
    const isNarrowScreen = window.innerWidth <= 768;
    return isNarrowScreen;
}

////////////////////////////////////////////////////////////////
// --- UZU ROASTER プロファイルストレージ管理 ---
////////////////////////////////////////////////////////////////
// ページ読み込み時にリストを初期化
window.addEventListener('DOMContentLoaded', () => {
    chartAreaInitialize();
    updateProfileList();
    initColorMode();
    connectionSelect();
});

// 保存モーダルを開いた時に現在のJSONからタイトルを自動セット
function openJSONSaveModalCustom() {
    const jsonStr = document.getElementById('jsonSave').value;
    try {
        const data = JSON.parse(jsonStr);
        // JSON内のtitleをインプット欄にデフォルトセット
        document.getElementById('profileTitleInput').value = data.title || "";
    } catch (e) {
        console.error("JSON解析失敗、デフォルト名を使います");
        document.getElementById('profileTitleInput').value = "";
    }
}

// 【保存】ストレージに保存（50個制限）
function saveProfileToLocalStorage() {
    const jsonStr = document.getElementById('jsonSave').value;
    let title = document.getElementById('profileTitleInput').value.trim();
    
    if (!title) {
        alert("タイトルを入力してください");
        return;
    }

    let index = JSON.parse(localStorage.getItem('uzu_profile_index') || "[]");
    
    // 新規保存かつ50個超えのチェック
    if (!index.includes(title) && index.length >= 50) {
        alert("【警告】保存上限（50個）に達しています。不要なプロファイルを削除してください\nファイル読込ダイアログからストレージのプロファイルを削除できます");
        return;
    }

    try {
        let data = JSON.parse(jsonStr);
        data.title = title; // 入力されたタイトルでJSON内も更新
        
        // ストレージ保存
        localStorage.setItem('uzu_profile_data_' + title, JSON.stringify(data));
        
        // インデックス更新（重複してなければ追加）
        if (!index.includes(title)) {
            index.push(title);
            localStorage.setItem('uzu_profile_index', JSON.stringify(index));
        }
        
        alert("ストレージに保存しました： " + title);
        updateProfileList(); // リストを更新
        const modal = document.getElementById('jsonSaveModal');
        modal.classList.add('fx-close');
        setTimeout(() => {
          if (modal.classList.contains('fx-close')) {
              modal.classList.remove('fx-open');
              modal.style.display = 'none';
              modal.classList.remove('fx-close');
          }
        }, 600);
    } catch (e) {
        alert("JSONデータが正しくありません。");
    }
}

// 【リスト更新】削除ボタン付きのリスト生成
function updateProfileList() {
  const index = JSON.parse(localStorage.getItem('uzu_profile_index') || "[]");
  const listElement = document.getElementById('profileList');
  if (!listElement) return;

  listElement.innerHTML = ''; // リセット

  index.forEach(title => {
      const container = document.createElement('div');
      // style属性をcssTextで指定（スマホ対策）
      container.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:#222; margin-bottom:2px; padding:1px; border-radius:4px;";

      // タイトルボタン（クリックで読み込み）
      const btn = document.createElement('div');
      btn.innerText = title;
      // style属性をcssTextで指定（スマホ対策）
      btn.style.cssText = "flex-grow:1; cursor:pointer; color:#fff; font-size:16px; max-width:calc(100% - 60px); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;border:1px solid rgba(255,255,255,0.3); padding:0px 1px; border-radius:3px; background:#333;";
      btn.onclick = () => {
          const data = localStorage.getItem('uzu_profile_data_' + title);
          document.getElementById('jsonInput').value = data;
      };

      // 削除ボタン（X）
      const delBtn = document.createElement('button');
      delBtn.innerHTML = "<span style='white-space: nowrap; font-size:14px;'>&times;削除</span>";
      // style属性をcssTextで指定（スマホ対策）
      delBtn.style.cssText = "background:#800; color:#fff; border:none; padding:1px 8px; cursor:pointer; border-radius:3px; margin-left:10px;";
      delBtn.onclick = (e) => {
          e.stopPropagation(); // 親のクリックイベントを防ぐ
          if (confirm("プロファイル「" + title + "」を完全に削除してもいいですか？")) {
              deleteProfile(title);
          }
      };

      container.appendChild(btn);
      container.appendChild(delBtn);
      listElement.appendChild(container);
  });
}

// 【削除】
function deleteProfile(title) {
    localStorage.removeItem('uzu_profile_data_' + title);
    let index = JSON.parse(localStorage.getItem('uzu_profile_index') || "[]");
    index = index.filter(t => t !== title);
    localStorage.setItem('uzu_profile_index', JSON.stringify(index));
    updateProfileList();
}

////////////////////////////////////////////////////////////////
// ポップアップのテキストエリアをクリックしたときの処理
////////////////////////////////////////////////////////////////
textarea.addEventListener('click', () => {
    popupText.value = textarea.value;
    popup.classList.add('fx-open');
    popupText.focus();
});

closeButton.addEventListener('click', () => {
    textarea.value = popupText.value;
    popup.classList.add('fx-close');
    setTimeout(() => {
      if (popup.classList.contains('fx-close')) {
          popup.classList.remove('fx-open');
          popup.style.display = 'none';
          popup.classList.remove('fx-close');
    }
    }, 600);
});

let socket = null;
let keepAliveTimeout = null; // キープアライブタイマー
const pendingResponses = new Map();
const liveData = [];
let isRoasting = false;

connectWebSocket();
ResetKeepAliveTimer();

// 初期化後、WebSocket接続状態を確認（既に接続済みの場合のための処理）
setTimeout(() => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    updateConnectionStatus(true);
  }
}, 500);

// 画面にフォーカスが戻った時（スリープ復帰時）に発動
window.onfocus = function() {
  webReconnect();
};

function webReconnect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  setTimeout(() => {
    connectWebSocket();
  }, 200);
}

function receiveWebMessage(data) {
  const t = (data.temp + TemperatureOffset); // 温度にオフセットを適用し、1桁小数にフォーマット
  const temp = t.toFixed(1); // 温度にオフセットを適用し、1桁小数にフォーマット
  if ("time" in data && "temp" in data) {
    if (data.time > -1 && isRoasting) {
      document.getElementById('roast_message').textContent = "焙煎中";

      const current_ror = addLiveDataPoint(roastChart, data.time, t); // グラフ追加関数
      document.getElementById('roast_time').innerHTML = formatSecondsToMinutesSeconds(data.time); 
      document.getElementById('roast_temperature').innerHTML = temp + unit_temp;
      if (roastChart.data.datasets[0].data.length === 0) {
          document.getElementById('profile_temperature').innerHTML = "--" + unit_temp;
          document.getElementById('profile_ror').innerHTML = "--" + unit_ror;
      }
      else {	
        const profileTemp = getOneSecondIntervalProfile(getProfileDataFromTable());
        if (profileTemp[0].time >= data.time) {
          document.getElementById('profile_temperature').innerHTML = profileTemp[0].temp.toFixed(1) + unit_temp;
        }   
        else if (profileTemp[profileTemp.length - 1].time >= data.time) {    
          document.getElementById('profile_temperature').innerHTML = profileTemp[data.time - profileTemp[0].time].temp.toFixed(1) + unit_temp;      
        }   
        else {
          document.getElementById('profile_temperature').innerHTML = profileTemp[profileTemp.length - 1].temp.toFixed(1) + unit_temp;      
        }

        if (roastChart.data.datasets[2].data.length > 0) {
          if (roastChart.data.datasets[2].data.length > data.time) {
            document.getElementById('profile_ror').innerHTML = (roastChart.data.datasets[2].data[data.time].y).toFixed(1) + unit_ror;
          }
          else {
            document.getElementById('profile_ror').innerHTML = "--" + unit_ror;
          }
        }
      }
      document.getElementById('roast_ror').innerHTML = current_ror.y.toFixed(1) + unit_ror;
    }
    else {	//焙煎中以外は現在温度のみ表示
      if (!isMinutesSecondsFormat) {
        document.getElementById('roast_time').innerHTML = "--" + unit_sec;
      }
      else {
        document.getElementById('roast_time').innerHTML = "--:--"; 
      }
      document.getElementById('roast_temperature').innerHTML = temp + unit_temp;
      document.getElementById('profile_temperature').innerHTML = "--" + unit_temp;
      document.getElementById('profile_ror').innerHTML = "--" + unit_ror;
      document.getElementById('roast_ror').innerHTML = "--" + unit_ror;        
    }
    
    if (isRoasting == true && data.time >= 1800 - 1) {
      sendStopCommand();
    }
    updateChartDsiaplayValue();  
  }  
}

function ResetKeepAliveTimer() {
  if (window.pywebview) { return; }
  if (keepAliveTimeout) {     
    clearTimeout(keepAliveTimeout);
  } 

  keepAliveTimeout = setTimeout(() => {
    if (window.pywebview) { return; }
    console.warn("キープアライブメッセージが受信できませんでした");
    updateConnectionStatus(false);
    document.getElementById('roast_message').textContent = "接続が解除されました";
    //sendStopCommand(); // 焙煎を停止
    HideChartIndicators();
    webReconnect(); // 再接続を試みる
    keepAliveTimeout = null; // タイマーをリセット
    ResetKeepAliveTimer();
  }, 30000); // 30秒ごとにキープアライブチェック
}

//デバッグ用関数群
////////////////////////////////////////////////////////////////
let TemperatureOffset = 0;
function OffsetIncrement(offset){
  TemperatureOffset += offset;
}
function OffsetReset(){
  TemperatureOffset = 0;
}
function CloseOffsetDialogBox(){
  document.getElementById('debug_console').style.display = "none";
}
function sendDebugCommand() {
    const input = document.getElementById('cmdInput');
    const text = input.value.trim(); // 前後の空白を消す
    if (text !== "") {
      window.pywebview.api.send_command(text); 
      input.value = "";
    }
}

function connectWebSocket() {
  if (window.pywebview) { return; }
  // 81番ポートを指定してWebSocket接続URLを作成
  const currentHost = window.location.hostname;
  if (currentHost == "") {  // ローカルからアクセス
	  socket = new WebSocket("ws://192.168.4.1:81/"); 
  }
  else if (currentHost == "uzuuzu.shop") {  
    const websocketUrl = `https://${currentHost}:81/`;
    socket = new WebSocket(websocketUrl);
  }
  else {
    const websocketUrl = `ws://${currentHost}:81/`;
    socket = new WebSocket(websocketUrl);
  }

  // イベントハンドラを設定
  socket.onopen = () => {
    updateConnectionStatus(true);
    console.log("WebSocket接続");
  };
  
  socket.onclose = () => {  
    if (window.pywebview) {
      return;
    }
    updateConnectionStatus(false);
    document.getElementById('roast_message').textContent = "接続が解除されました";
    SetRoastingState(false);
    HideChartIndicators();
    console.log("WebSocket切断");
  };
  
  socket.onerror = (error) => {
    console.error("WebSocketエラー:", error);
    updateConnectionStatus(false);
  };
  
  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      receiveWebMessage(data);
      if ("msg" in data) {
        if (data.msg === "KEEP_ALIVE") {
          ResetKeepAliveTimer();
          return;
        }
        else if (data.msg !== "") { 
          document.getElementById('roast_message').textContent = data.msg;
        } 
      }
      else if (data.id && pendingResponses.has(data.id)) {
        pendingResponses.get(data.id)(data);
        pendingResponses.delete(data.id);
      } 
      else {
        console.log("その他のメッセージ:", data);
      }
    } catch (e) {
      console.error("JSON解析エラー", e);
      hideUploadOverlay(); 
    }
  };
}

function generateUniqueId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}
function SetRoastingState(flag) {
    isRoasting = flag;
	  document.getElementById('stop-button').disabled = !flag;
	  document.getElementById('start-button').disabled = flag;
	  showRoastingIndicator(flag);

    function disableInputsByClass(roasting_flag) {
      const className = 'table_edit'; // 対象のクラス名
      const inputs = document.querySelectorAll(`.${className}`);
      inputs.forEach(input => {
          input.disabled = roasting_flag;
      });
    }
    disableInputsByClass(flag)
}

document.addEventListener('keydown', function(event) {
    if (event.code === 'Space') {
        // イベント発生元が入力要素（input, textarea）でないことを確認
        // これがないと、入力中にスペースキーを押してもボタンが押されてしまう
        const tagName = event.target.tagName;
        if (tagName !== 'INPUT' && tagName !== 'TEXTAREA') {
          let button;
          if (!isRoasting) {
            button = document.getElementById('start-button');
          }
          else {
            button = document.getElementById('stop-button');
          }
            if (button) {
                button.click(); // ボタンのクリックイベントをプログラム的に発火
                event.preventDefault(); // スペースキーのデフォルト動作（スクロールなど）をキャンセル
            }
        }
    }
});

function showRoastingIndicator(flag) {
	if (flag) {
  		document.getElementById("roasting-indicator").classList.remove("hidden");
	}
	else {
  		document.getElementById("roasting-indicator").classList.add("hidden");
	}
}

function sendSafe(data) {
  try {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(data));
    } else {
      alert("WebSocketが未接続です。\n 再接続してください。");
      // 必要なら再接続処理とかキューに貯める処理もここで
    }
  } catch (err) {
    alert("WebSocketに異常があります。\n再接続してください\nエラーコード：", err);
    hideUploadOverlay(); 
    // エラー処理（UIに通知とか、ログに出すとか）入れてもOK
  }
}

function helpButtonCommand() {
  alert(`UZU ROASTER　Version${UzuRoasterVersionStr}
うずロースターコントローラー　Version${UzuRoasterControllerVersionStr}

Developed and Maintained
うずうず本舗/うずうず珈琲焙煎工房

`);
}

function manualButtonCommand() {
  window.open("uzu_roaster_manual.html", "_blank");
}

function ResetButtonCommand() {
  const result = confirm("UZU ROASTERをリセットします。よろしいでしょうか？");
  if (!result) {
      return;
  }

  if (window.pywebview && window.pywebview.api) {
    // Python版：API経由でコマンド送信
    window.pywebview.api.send_command("reset");
    alert("システムをリセットしました");
    setTimeout(() => {    
      location.reload(true);
      window.pywebview.api.send_command("usbserial on");
    }, 2000); // ESP32リセット時間待つ
    return;
  }

  const id = generateUniqueId(); // 一意なIDをつける
  const message = { command: "reset", id: id  };
  sendSafe(message);
  console.log("リセットコマンド送信");
  // キャッシュを無視して強制的にリロード (サーバーから再取得)
  setTimeout(() => {    
    location.reload(true);
  }, 1000);
}

function configButtonCommand() {
  const id = document.getElementById('debug_console');
  if (window.getComputedStyle(id).display === "none") {
    id.style.display = "block";
  } 
  else {
    id.style.display = "none";
  }
}

function WebButtonCommand() {
  window.open("https://uzuuzu.shop", "_blank"); 
}

function enlargeChart() {
  widthOffset = 1800;
  if (!isRoasting) {
    AutoChartWidthAdjustment(roastChart, 0, widthOffset); // AUTO
    roastChart.update(); 
  } // 焙煎中でない場合は更新
}
function shotenChart() {
  const latestLivePoint = roastChart.data.datasets[1].data[roastChart.data.datasets[1].data.length - 1];
  if (isRoasting) { 
    const currentTime = latestLivePoint.x;
    widthOffset = -maxChartWidth + currentTime + 120; // 現在時間を基準にして、120秒先まで表示
  }
  else {
    //widthOffset = -maxChartWidth + 100;  //　適当
    AutoChartWidthAdjustment(roastChart, 0, 200); // AUTO
    roastChart.update();  // 焙煎中でない場合は更新
  }
}

function resetWidthChart() {
  widthOffset = 0;
  if (!isRoasting) { 
    AutoChartWidthAdjustment(roastChart, 0); // AUTO
    roastChart.update(); 
  } // 焙煎中でない場合は更新
}

function toggleChartDisplay(flag) {
    //const tempDiv = document.getElementById(flag);
    const tempDiv = document.getElementById('chart-area-infos');
    const infos_button = document.getElementById('chart-infos-button');

    // 表示されてたら消す、消えてたら出す
    if (flag) {
        infos_button.style.opacity = '';
        infos_button.style.transform = '';
        infos_button.animate([
        { transform: 'scale(1)', opacity: 1, offset: 0 },
        { transform: 'scale(1.5)', opacity: 1, offset: 0.66 }, // 0.2秒地点
        { transform: 'scale(1)', opacity: 0.3, offset: 1 }         // 0.3秒地点
        ], {
          duration: 300, // 0.3秒
          easing: 'ease-out',
          fill: 'forwards',
          composite: 'replace' 
        });
        tempDiv.classList.remove('vanish');
        tempDiv.classList.add('appear');
        tempDiv.style.display = 'block';
        setTimeout(() => {
          tempDiv.classList.remove('appear');
          infos_button.style.setProperty('opacity', '0.3', 'important');
       }, 400);
      } else {
        tempDiv.classList.add('vanish');
        setTimeout(() => {
          tempDiv.style.display = 'none';
          tempDiv.classList.remove('vanish'); 
          infos_button.style.opacity = '';
          infos_button.style.transform = '';
          infos_button.animate([
          { transform: 'scale(1)', opacity: 0.3, offset: 0 },
          { transform: 'scale(1.5)', opacity: 0.8, offset: 0.66 }, // 0.2秒地点
          { transform: 'scale(1)', opacity: 1, offset: 1 }         // 0.3秒地点
          ], {
            duration: 300, // 0.3秒
            easing: 'ease-out',
            fill: 'forwards',
            composite: 'replace' 
          });
          setTimeout(() => {
            infos_button.style.setProperty('opacity', '1.0', 'important');
          }, 300);
        }, 500);
    }
}

function updateChartDsiaplayValue() {
    const idMap = {
        'roast_time':   'currentTimeInside',
        'roast_temperature':   'currentTempInside',
        'roast_ror':           'currentRoRInside',
        'profile_temperature': 'profileTempInside',
        'profile_ror':         'profileRoRInside'
    };

    Object.entries(idMap).forEach(([srcId, destId]) => {
      const srcEl = document.getElementById(srcId);
      const destEl = document.getElementById(destId);
      if (srcEl && destEl) {
          destEl.innerHTML = srcEl.innerHTML;
      }
    });
}

////////////////////////////////////////////////////////////////
function sendStartCommand() {
  LiveData = [];
	sortTable();
  applyOffsetsToTable(); // テーブルのオフセットを適用  
  if (window.pywebview && window.pywebview.api) {
    // Python版：API経由でコマンド送信
    window.pywebview.api.send_command("start");
    executeStartCommand();
    return;
  }
  const id = generateUniqueId(); // 一意なIDをつける
  const message = { command: "start", id: id  };
  sendSafe(message);
  console.log("スタートコマンド送信");

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingResponses.delete(id);
      alert("焙煎スタートがタイムアウトしました。\nWiFi接続を確認してください。");
  		SetRoastingState(false);
      reject(new Error("タイムアウト"));
    }, 3000); 

    pendingResponses.set(id, (response) => {
      clearTimeout(timeout);
      if (response.status === "ok") {
        console.log("焙煎スタートACK受信", response);
        executeStartCommand();
        resolve(response);
      } 
      else {
        alert("焙煎スタートに失敗しました。\nWiFi接続を確認してください。\nスタート失敗:" + response.message);
  		  SetRoastingState(false);
        reject(new Error("スタート失敗: " + response.message));
      }
    });
  });

  ////////////////////////////////////////////////////////////////
  function executeStartCommand(){
    document.getElementById('roast_message').textContent = "焙煎中";
    roastChart.destroy();
    initChart();
    updateChartWithProfile(getProfileDataFromTable());
    SetRoastingState(true);

    isCompareProfileShown = false;
    document.getElementById('button-copy-profile').textContent = "📈 比較プロファイル表示";
  }
}

function sendStopCommand() {
  SetRoastingState(false);
  HideChartIndicators();
  
  if (window.pywebview && window.pywebview.api) {
    // Python版：API経由でコマンド送信
    window.pywebview.api.send_command("stop");
    executeStopCommand();
    return;
  }

  const id = generateUniqueId(); // 一意なIDをつける
  const message = { command: "stop", id: id  };
  sendSafe(message);
  console.log("ストップコマンド送信");
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingResponses.delete(id);
      alert("焙煎ストップがタイムアウトしました。\nWiFi接続を確認してください。");
      reject(new Error("タイムアウト"));
    }, 3000); // 3秒でタイムアウトする

    pendingResponses.set(id, (response) => {
      clearTimeout(timeout);
      if (response.status === "ok") {
        executeStopCommand();  
        resolve(response);
      } else {
        alert("焙煎ストップに失敗しました。\nWiFi接続、うずロースターの電源を確認してください。\nストップ失敗:" + response.message);
        reject(new Error("ストップ失敗: " + response.message));
      }
    });
  });

  function executeStopCommand(){
    document.getElementById('roast_message').textContent = "焙煎を停止しました";
  }
 
}

function HideChartIndicators() {
  const img = document.getElementById('chart-point');   
  if (img) {  
    img.style.display = 'none'; // グラフのポイントを非表示
    if (img.classList.contains('pointer-animation')) {
      img.classList.remove('pointer-animation'); // アニメーションを削除
    }
  }   
  const arrowElement = document.getElementById('chart-arrow');
  if (arrowElement) {       
    arrowElement.style.display = 'none'; // 矢印を非表示
  } 
  const dashLine = document.getElementById('overlayCanvas');
  if (dashLine) {       
    dashLine.style.display = 'none'; 
  }   
 
}

function ShowChartIndicators() {
  const img = document.getElementById('chart-point');   
  if (img) {  
    img.style.display = 'block'; 
    if (img.classList.contains('pointer-animation')) {
      img.classList.add('pointer-animation'); 
    }
  }   
  const arrowElement = document.getElementById('chart-arrow');
  if (arrowElement) {       
    arrowElement.style.display = 'block'; 
  }   
  const dashLine = document.getElementById('overlayCanvas');
  if (dashLine) {       
    dashLine.style.display = 'block'; 
  }   
}

/*
function sendProfileInBatches(profileData) {
  const BATCH_SIZE = 100;
  const totalBatches = Math.ceil(profileData.length / BATCH_SIZE);
  const id = generateUniqueId();

  return new Promise(async (resolve, reject) => {
    let batchIndex = 0;

    const sendNextBatch = () => {
      if (batchIndex >= totalBatches) return;

      const start = batchIndex * BATCH_SIZE;
      const batch = profileData.slice(start, start + BATCH_SIZE);

      const message = {
        command: "generic",
        id: id,
        type: "profile_upload_batch",
        part: batchIndex,
        isLast: batchIndex === totalBatches - 1,
        profile: batch
      };

      sendSafe(message);

      const timeout = setTimeout(() => {
        pendingResponses.delete(`${id}_${batchIndex}`);
        reject(new Error(`バッチ ${batchIndex} のACKが来てません`));
      }, 3000);

      pendingResponses.set(`${id}_${batchIndex}`, (response) => {
        clearTimeout(timeout);
        if (response.status === "ok") {
          batchIndex++;
          if (batchIndex === totalBatches) {
            resolve(response); // 最後まで完了！
            document.getElementById('roast_message').textContent = "プロファイルをアップロードしました";
          } else {
            sendNextBatch(); // 次へ
          }
        } else {
          reject(new Error(`アップロード失敗: ${response.message}`));
        }
      });
    };

    sendNextBatch();
  });
}
*/

const UZU_PRESETS = {
  light: {
    "type": "roast_profile",
    "title": "Lao's Light (浅煎り)",
    "memo": "スコット・ラオ理論準拠。10分で210℃着地。酸味と香りを最大化します。",
    "profile": [ /* 5秒刻みデータ（略式記載、実際はロジックで生成） */ ]
  },
  medium: {
    "type": "roast_profile",
    "title": "Standard Medium (中煎り)",
    "memo": "12分で225℃着地。甘みと苦みのバランスが良い黄金比プロファイルです。",
    "profile": [ /* さっきの真・黄金比データ */ ]
  },
  dark: {
    "type": "roast_profile",
    "title": "Deep & Rich (深煎り)",
    "memo": "15分かけて240℃へ。後半のRoRを落とし、芯までじっくり火を通します。",
    "profile": [ /* 5秒刻みの徐冷データ */ ]
  }
};

// プリセットを適用
function applyPreset(key) {
  const selectedData = UZU_PRESETS[key];
  selectedData.profile = generateCurveData(key);
  document.getElementById("profileTitle").value = selectedData.title;
  document.getElementById("profileMemo").value = selectedData.memo;

  // 5秒刻みの完全なデータを動的生成（ラオ・ルール計算式）
  const table = document.getElementById('profileTable');
  while (table.rows.length > 1) {
    table.deleteRow(1);
  }
  selectedData.profile.forEach(point => {
    // データポイントは{x: time, y: temp}形式
    addRow(point.time, point.temp);
  });
  console.log("ガイドプロファイルでテーブルを上書きしました", selectedData.profile.length + "ポイント");
  sendCurrentProfile();
  closeProfModal();
}

// 数学的カーブ生成エンジン
function generateCurveData(type) {
  let curve = [];
  let totalTime = (type === 'light') ? 600 : (type === 'medium') ? 720 : 900;
  let targetTemp = (type === 'light') ? 210 : (type === 'medium') ? 225 : 240;
  
  for (let t = 0; t <= totalTime; t += 5) {
    // 対数関数を使ってRoRを徐々に減衰させる計算（ラオ・ルール）
    let progress = t / totalTime;
    let temp = 25 + (targetTemp - 25) * (Math.log(1 + progress * 9) / Math.log(10));
    curve.push({ "time": t, "temp": parseFloat(temp.toFixed(1)) });
  }
  return curve;
}

function sendCurrentProfile() {
  
  sortTable();
  applyOffsetsToTable(); // テーブルのオフセットを適用
  const profileData = getProfileDataFromTable();
  updateChartWithProfile(profileData);
  return; // 直接アップロードはしない 
}

function overwriteTableWithLastRoast() {
  // リアルタイムデータの確認（datasets[1]が存在し、データがあるか確認）
  if (!roastChart || !roastChart.data.datasets || !roastChart.data.datasets[1] || !roastChart.data.datasets[1].data || roastChart.data.datasets[1].data.length === 0) {
    alert("直前の焙煎データが存在しません。焙煎を行ってください。");
    return;
  }

  // リアルタイムデータを取得
  const realTimeData = roastChart.data.datasets[1].data;
  
  // テーブルを初期化（ヘッダー以外を削除）
  const table = document.getElementById('profileTable');
  while (table.rows.length > 1) {
    table.deleteRow(1);
  }
  
    // リアルタイムデータをテーブルに追加
  realTimeData.forEach(point => {
    // データポイントは{x: time, y: temp}形式
    addRow(point.x, point.y);
  });
  
  console.log("直前の焙煎データでテーブルを上書きしました", realTimeData.length + "ポイント");
  sendCurrentProfile();
}

function showUploadOverlay() {
  document.getElementById("uploadOverlay").style.display = "flex";
}

function hideUploadOverlay() {
  document.getElementById("uploadOverlay").style.display = "none";
}

/**
 * 秒数を「分:秒」形式の文字列に変換します。
 * 例: 90秒 -> "1:30"
 * @param {number} totalSeconds - 合計秒数。
 * @returns {string} 分:秒形式の文字列。
 */
function formatSecondsToMinutesSeconds(totalSeconds) {
    if (!isMinutesSecondsFormat) {
      return totalSeconds + unit_sec; // 秒表示
    }
    if (totalSeconds < 0) totalSeconds = 0; // 負の値は0として扱う

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60); // 小数点以下は切り捨てて秒にする

    // 秒が1桁の場合に先頭に0を追加 (例: 1:05)
    const formattedSeconds = seconds < 10 ? '0' + seconds : seconds;

    return `${minutes}:${formattedSeconds}`;
}

let LiveData = [];
function addLiveDataPoint(chart, time, temp) {
  if (typeof time === 'number' && typeof temp === 'number') {
    const newPoint = { x: time, y: temp };
    //console.log("data:", time, temp);
    LiveData.push(newPoint);

    chart.options.plugins.verticalLinePlugin.xValue = time;	//縦軸
    let lastPoint = { x: 0, y: 0 };
    if (LiveData.length > 1) {
      lastPoint = LiveData[LiveData.length - 1];
    }
    else {
      lastPoint = newPoint;
    }
    const RoR = { x: time, y: calculateRoR(LiveData) };
    chart.data.datasets[1].data.push(newPoint);
    chart.data.datasets[3].data.push(RoR);
    updateCorrectionVisuals(chart, newPoint, ProfileSecondData);
    AutoChartWidthAdjustment(chart, 0); // 最大値+1で表示範囲を調整
    chart.update(); // ← 'none' にするとアニメーションもカット

    return RoR;
  }
}


function addRow(time = '', temp = '') {
  const table = document.getElementById('profileTable');
  const row = table.insertRow();
  const timeCell = row.insertCell(0);
  const tempCell = row.insertCell(1);
  const deleteCell = row.insertCell(2);

  timeCell.innerHTML = `<input class="table_edit" type="number" value="${time}" step="1" min="0" max="1799" oninput="validateInput_time(this, 0, 1799)">`;
  tempCell.innerHTML = `<input class="table_edit" type="number" value="${temp}" min="0" max="260" oninput="validateInput_temperature(this, 0, 260)">`;
  deleteCell.innerHTML = `<button class="table_edit" onclick="this.parentNode.parentNode.remove()">🗑</button>`;
}

function validateInput_temperature(input, min, max) {
  let value = parseFloat(input.value);
  
  // 数値でない場合は空文字にする
  if (isNaN(value)) {
    input.value = '';
    return;
  }
  
  // 範囲外の場合は制限する
  if (value < min) {
    input.value = min.toString();
  } else if (value > max) {
    input.value = max.toString();
  }
}
function validateInput_time(input, min, max) {
  let value = parseInt(input.value);
  
  // 数値でない場合は空文字にする
  if (isNaN(value)) {
    input.value = '';
    return;
  }
  
  // 範囲外の場合は制限する
  if (value < min) {
    input.value = min.toString();
    return;
  } else if (value > max) {
    input.value = max.toString();
    return;
  }
  input.value = value.toString();

}

function sortTable() {
  const table = document.getElementById('profileTable');
  const rows = Array.from(table.rows).slice(1); // ヘッダー以外

  const latestEntries = new Map();

  // 最新のエントリを上書き保存
  rows.forEach(row => {
    let time = parseFloat(row.cells[0].firstChild.value);
    let temp = parseFloat(row.cells[1].firstChild.value);
    if (time < 0) time = 0;
    else if (time > 1800 - 1) time = 1800 - 1;
    if (temp < 0) temp = 0;
    else if (temp > 260) temp = 260;
    
    if (!isNaN(time) && !isNaN(temp)) {
      latestEntries.set(time, { time, temp });
    }
  });

  // 時間順にソート
  const sorted = Array.from(latestEntries.values()).sort((a, b) => a.time - b.time);

  // テーブルを全削除
  while (table.rows.length > 1) {
    table.deleteRow(1);
  }

  // テーブル再描画（削除ボタン付き）
  sorted.forEach(({ time, temp }) => {
    addRow(time, temp);
  });
}

function applyOffsetsToTable() {
    const table = document.getElementById('profileTable');
    
    // 1. オフセット値を取得
    const inputTime = document.getElementById('offset-input-time');
    const inputTemp = document.getElementById('offset-input-temp');
    const timeOffset = parseInt(inputTime.value) || 0;
    const tempOffset = parseInt(inputTemp.value) || 0;

    // 2. 現在のテーブルから全データを吸い出す（ここは変更なし）
    const currentData = [];
    for (let i = 1; i < table.rows.length; i++) {
        const row = table.rows[i];
        const tInput = row.cells[0].querySelector('input');
        const tempInput = row.cells[1].querySelector('input');
        if (tInput && tempInput) {
            currentData.push({
                time: parseFloat(tInput.value) || 0,
                temp: parseFloat(tempInput.value) || 0
            });
        }
    }
    // 3. テーブルを全削除
    while (table.rows.length > 1) {
        table.deleteRow(1);
    }
    // 4. ガードルールを適用して再追加
    currentData.forEach(entry => {
        let newTime = entry.time + timeOffset;
        let newTemp = entry.temp + tempOffset;

        if (newTime < 0 || newTime >= 1800) return;
        newTemp = Math.min(Math.max(newTemp, 0), 260);

        addRow(newTime, newTemp);
    });
    //時間がゼロの点がなくなったら、0秒で一番近い時間の温度の点を追加する
    if (table.rows.length > 1 && table.rows[1].cells[0].firstChild.value != "0") {
      let closestTemp = null;
      let minDiff = Infinity;
      for (let i = 1; i < table.rows.length; i++) {
          const row = table.rows[i];
          const tValue = parseFloat(row.cells[0].firstChild.value) || 0;
          const tempValue = parseFloat(row.cells[1].firstChild.value) || 0;
          const diff = Math.abs(tValue - 0);  
          if (diff < minDiff) {
              minDiff = diff;
              closestTemp = tempValue;
          }
      }
      addRow(0, closestTemp);
      sortTable(); // 再度ソートして順番を整える
    }
    
    //  5. 【お片付け】インプットフィールドをゼロに戻す！
    inputTime.value = 0;
    inputTemp.value = 0;
}

function createDeleteButton() {
  const button = document.createElement("button");
  button.textContent = "🗑";
  button.addEventListener("click", function () {
    const row = button.closest("tr");
    if (row) {
      row.parentNode.removeChild(row);
    }
  });
  return button;
}

/**
     * WebSocket接続状態の表示を更新
     */
function updateConnectionStatus(isConnected) {
  const statusIndicator = document.getElementById('socket-status');
  const connectionLabel = document.getElementById('connection-label');
  
  if (isConnected) {
    statusIndicator.style.backgroundColor = '#1ecc32';
    connectionLabel.textContent = '接続中';
  } else {
    statusIndicator.style.backgroundColor = '#cccccc';
    connectionLabel.textContent = '未接続';
  }
}
    
function downloadJSON() {
  const table = document.getElementById('profileTable');
  const rows = Array.from(table.rows).slice(1);
  const latestEntries = new Map();

  rows.forEach(row => {
    const time = parseFloat(row.cells[0].firstChild.value);
    const temp = parseFloat(row.cells[1].firstChild.value);
    if (!isNaN(time) && !isNaN(temp)) {
      latestEntries.set(time, temp);
    }
  });

  if (latestEntries.size === 0) {
    alert("テーブルに有効なプロファイルがありません。");
    return false;
  }

  const profile = Array.from(latestEntries.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([time, temp]) => ({ time, temp }));

  const title = document.getElementById("profileTitle")?.value || "";
  const memo = document.getElementById("profileMemo")?.value || "";

  const data = {
    type: "roast_profile",
    title,
    memo,
    profile
  };

  // ファイル名に現在の日時を追加
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  const filename = `roast_profile_${year}${month}${day}_${hours}${minutes}${seconds}.json`;
  const jsonString = JSON.stringify(data, null, 2);

  if (window.pywebview && window.pywebview.api) {
    (async () => {
      const success = await window.pywebview.api.save_file(jsonString);
      if (success) {
        document.getElementById('roast_message').textContent = "プロファイルの保存処理が完了しました";
      }
    })();
    return true; // Python側で処理したらここで終了
  }

  if (true) { // 将来的にWebからファイル保存できなくなるので手動コピー
    document.getElementById('jsonSave').value = jsonString;
    return true;
  }

  const base64Encoded = btoa(unescape(encodeURIComponent(jsonString)));
  const dataUri = `data:application/json;base64,${base64Encoded}`;

  const a = document.createElement("a");
  a.href = dataUri;
  a.download = filename;
  
  a.target = "_blank";
  
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  document.getElementById('roast_message').textContent = "プロファイルの保存処理が完了しました";
}

function showProfModal() {
  const modal = document.getElementById('profModal');
      modal.classList.add('fx-open');
}

function closeProfModal() {
    const modal = document.getElementById('profModal');
    modal.classList.add('fx-close');
    setTimeout(() => {
      if (modal.classList.contains('fx-close')) {
          modal.classList.remove('fx-open');
          modal.style.display = 'none';
          modal.classList.remove('fx-close');
    }
    }, 600);
    modal.classList.add('fx-open');
}

function closeJSONInputModal() {
    const modal = document.getElementById('jsonInputModal');
    modal.classList.add('fx-close');
    document.getElementById('jsonSave').value = '';
    setTimeout(() => {
      if (modal.classList.contains('fx-close')) {
          modal.classList.remove('fx-open');
          modal.style.display = 'none';
          modal.classList.remove('fx-close');
    }
    }, 600);
}
function closeJSONSaveModal() {
    const modal = document.getElementById('jsonSaveModal');
    modal.classList.add('fx-close');
    document.getElementById('jsonInput').value = '';
    setTimeout(() => {
      if (modal.classList.contains('fx-close')) {
          modal.classList.remove('fx-open');
          modal.style.display = 'none';
          modal.classList.remove('fx-close');
    }
    }, 600);
    modal.classList.add('fx-open');
}

function openJSONInputModal() {
    const modal = document.getElementById('jsonInputModal');
    modal.classList.add('fx-open');
    const textarea = document.getElementById('jsonInput');
    textarea.value = "";
    textarea.focus();
}

function openJSONSaveModal() {
    if (!window.pywebview) {
      const modal = document.getElementById('jsonSaveModal');
      ret = downloadJSON();
      if (ret == false) {
      }
      else {
        modal.classList.add('fx-open');
      }
      openJSONSaveModalCustom();
      const textarea = document.getElementById('jsonSave');
      textarea.focus();
      return;
    }

    downloadJSON();
}

function applyJSONInputModal() {
    const rawData = document.getElementById('jsonInput').value;
    const fileName = "dummyInputFileName.json";
    const dummyFile = { name: fileName };
    const dummyEvent = { target: { result: rawData } };
    const result = executeFileLoad(dummyFile, dummyEvent);
    if (result) {
      closeJSONInputModal();
    }
}

function applyJSONAllCopyModal() {
  if (true) {
    const area = document.getElementById('jsonSave');
    area.select();
    area.setSelectionRange(0, 99999); // スマホ用のおまじない
    jsonString = area.value;
    // クリップボードに直接書き込み（最新のやり方）
    navigator.clipboard.writeText(jsonString).then(() => {
        alert("クリップボードにコピーしました。メモ帳などにペーストして保存してください");
    }).catch(err => {
        // 万が一、ブラウザが拒否した時のバックアップ
        console.error('コピー失敗', err);
        alert("自動コピーできないようなので、手動でコピーしてください");
    });

    return;
  }
}

function openFileDialog() {
  if (window.pywebview && window.pywebview.api) {
      (async () => {
        const loadedData = await window.pywebview.api.load_file();
        if (loadedData) {
            // 1. Python から届いたパスからファイル名を取得
            const fileName = loadedData.path.split(/[\\/]/).pop();

            // 2. ブラウザの File オブジェクトと Event オブジェクトの「フリ」をするダミーを作る
            const dummyFile = { name: fileName };
            const dummyEvent = { target: { result: loadedData.content } };

            executeFileLoad(dummyFile, dummyEvent);
        }
    })();

    return;
  }

  if (true) {
    openJSONInputModal(); // JSONを貼り付けor書く
  }
  else {
    document.getElementById('fileInput').click(); // 将来的にWebからはファイルアクセスできなくなるので
  }
}

document.getElementById("fileInput").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
      executeFileLoad(file, e);
  };
  reader.readAsText(file);
});

function executeFileLoad(file, e){
  try {
    let result;

    // ファイル拡張子で判定（.alogか.jsonか）
    if (file.name.endsWith(".alog")) {
      // alog形式 → JSON変換
      const alogText = e.target.result;
      result = parseAlogManualScan(alogText, "", "");
    } 
    else if (file.name.endsWith(".csv")) {
      const csvText = e.target.result;
      result = parseCSV(csvText);
    } 
    else {
      // 通常のJSONパース
      result = JSON.parse(e.target.result);
      if (!Array.isArray(result.profile)) throw "Invalid format";
    }

    // タイトルとメモを反映
    document.getElementById("profileTitle").value = result.title || "";
    document.getElementById("profileMemo").value = result.memo || "";

    // テーブル初期化
    const table = document.getElementById('profileTable');
    while (table.rows.length > 1) table.deleteRow(1);

    result.profile.forEach(entry => {
      addRow(entry.time, entry.temp);
    });

    if (window.event && window.event.target) {
      event.target.value = ""; // 同じファイルでもイベント発火させるため
    }

    sendCurrentProfile();
    document.getElementById('roast_message').textContent = "プロファイルを読み込みました";

    return true;
  } catch (err) {
    alert("プロファイル読み込みに失敗しました: " + err);
    //hideUploadOverlay(); 
    return false;
  }

}

function getProfileDataFromTable() {
    const table = document.getElementById('profileTable');
    const rows = table.getElementsByTagName('tr');
    const profile = [];

    for (let i = 1; i < rows.length; i++) { // i=1 でヘッダー飛ばす
        const cells = rows[i].getElementsByTagName('td');
        if (cells.length < 2) continue;

        const time = parseInt(cells[0].querySelector('input')?.value);
        const temp = cells[1].querySelector('input')?.value;

        // 空白・NaNは無視
        if (isNaN(time) || isNaN(temp)) continue;

        profile.push({ time, temp });
    }

    return profile;
}

/**
 * 不規則な時間間隔のプロファイルデータから、1秒間隔で補間されたプロファイルデータセットを生成します。
 *
 * @param {Array<Object>} originalProfileData - 元の不規則な時間間隔のプロファイルデータ ({ time: number, temp: number })。
 * @returns {Array<Object>} 1秒間隔で補間されたプロファイルデータ ({ time: number, temp: number })。
 */
function getOneSecondIntervalProfile(originalProfileData) {
    if (originalProfileData.length < 2) {
        return originalProfileData; // データが少ない場合はそのまま返す
    }

    // 0秒から開始する
    const firstTime = 0;
    const lastTime = originalProfileData[originalProfileData.length - 1].time;

    const oneSecondIntervalData = [];

    for (let t = firstTime; t <= lastTime; t++) {
        const temp = getInterpolatedProfileTemp(originalProfileData, t);
        if (temp !== null) {
            oneSecondIntervalData.push({ time: t, temp: temp });
        }
    }
    return oneSecondIntervalData;
}

function updateChartWithProfile(profileData) {
  if (!roastChart) return;

  const times = profileData.map(p => p.time);
  const temps = profileData.map(p => p.temp);

  roastChart.data.labels = times;
  roastChart.data.datasets[0].data = temps;
  AutoChartWidthAdjustment(roastChart, 0); // 最大値+1で表示範囲を調整
  prof_sec_data_ = getOneSecondIntervalProfile(profileData);
  roastChart.data.datasets[2].data = [];

  // `time` を `x` に、`temp` を `y` にリネームして抽出し、残りを `rest` に集約
  exchangeData = ({ time: x, temp: y, ...rest }) => ({ x, y, ...rest });
  ProfileSecondData = prof_sec_data_.map(exchangeData);

  for (let i = 0; i < ProfileSecondData.length; i++) {
    const t = calculateRoR(ProfileSecondData, i); // RoRを計算してデータセットに追加
    if (t != null) {
      roastChart.data.datasets[2].data.push({ x: ProfileSecondData[i].x, y: t });  
    }
  }

  roastChart.update();
}

function AutoChartWidthAdjustment(chart, minTime, maxTime = -1) {
  chart.options.scales.x.min = minTime;
  if (maxTime != -1) {
    chart.options.scales.x.max = maxTime;
    return;
  }
  let x = 0;
  let x1 = 0;
  let profile = getProfileDataFromTable();
  if (profile.length > 0) {
    x = profile[profile.length - 1].time;
  } 
  if (chart.data.datasets[1] && chart.data.datasets[1].data.length > 0) { 
    x1 = chart.data.datasets[1].data[chart.data.datasets[1].data.length - 1].x;
  }
  maxChartWidth = x + x1 + 200;

  chart.options.scales.x.min = minTime;
  chart.options.scales.x.max = Math.min(maxChartWidth + widthOffset, 1800); // 最大値+1で表示範囲を調整
}

const verticalLinePlugin = {
  id: 'verticalLinePlugin',
  beforeDraw(chart, args, options) {
    const { ctx, chartArea: { left, right, top, bottom }, scales: { x } } = chart;
    const xValue = options.xValue;

    // x座標を取得
    const xPos = x.getPixelForValue(xValue);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(xPos, top);
    ctx.lineTo(xPos, bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = options.color || 'rgba(0,0,100,0.3)';
    ctx.stroke();
    ctx.restore();
  }
};

function initChart() {
  const ctx = document.getElementById('roastChart').getContext('2d');

  // グラデーション作成（縦方向）
  const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.4)');
  gradient.addColorStop(0.8, 'rgba(0, 0, 0, 0.1)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0.03)');

  roastChart = new Chart(ctx, {
      type: 'line',
      data: {
          labels: [], // profileDataは既存のHTMLから取得する必要がある
          datasets: [{
              label: 'プロファイル温度',
              data: [],
              borderColor: active_profile_color,
              fill: true,
              tension: 0,
              borderCapStyle: 'round',  // 線の先端を丸く
              borderJoinStyle: 'round', // 線のつなぎ目を丸く            
              order: 20, // リアルタイム温度より下に表示
              backgroundColor: 'rgba(0, 0, 0, 0.08)', 
              borderWidth: 2, //1,
              pointRadius: 0, // 2, 
              pointHoverRadius: 8
          }, {
              label: '現在温度',
              data: [], // ここを最初から空配列に
              borderColor: 'rgba(255, 66, 99, 1)',
              fill: false,
              tension: 0.1,
              borderCapStyle: 'round',  // 線の先端を丸く
              borderJoinStyle: 'round', // 線のつなぎ目を丸く            
              order: 1,
              backgroundColor: 'rgba(255, 66, 99, 0.8)',
              borderWidth: 3,
              pointRadius: 0, //2,
              pointHoverRadius: 8
          }, {
              label: 'RoR (プロファイル温度）',
              data: [],
              borderColor: 'rgba(75, 68, 178, 0.4)', 
              backgroundColor: 'rgba(157, 132, 255, 0.4)',
              fill: false,
              tension: 0,
              borderCapStyle: 'round',  // 線の先端を丸く
              borderJoinStyle: 'round', // 線のつなぎ目を丸く            
              yAxisID: 'y1', // 別のY軸を使う
              order: 5, 
              borderWidth: 2, //1,
              pointRadius: 0, //1,
              pointHoverRadius: 8
          },{
              label: 'RoR (現在温度)',
              data: [],
              borderColor: 'rgba(194, 120, 29, 0.5)', 
              backgroundColor: 'rgba(255, 223, 61, 0.5)',
              fill: false,
              borderCapStyle: 'round',  // 線の先端を丸く
              borderJoinStyle: 'round', // 線のつなぎ目を丸く            
              tension: 0.1,
              yAxisID: 'y1', // 別のY軸を使う
              order: 10, 
              borderWidth: 2, //1,
              pointRadius: 0, //1,
              pointHoverRadius: 8
          }]
      },
      options: {
          responsive: true,
          maintainAspectRatio: false,
          animations: {
            scales: {
                properties: ['x', 'y'], // x軸とy軸のスケール変化を対象にする
                type: 'number', // 数値プロパティのアニメーション
                easing: 'easeOutQuart', // アニメーションのイージング
                duration: 500, // アニメーションの時間（例: 500ms）
            },
            y: { // y軸の値（データポイント）のアニメーション設定
                properties: ['y'],
                type: 'number',
                duration: 0, // 0ms (無効)
            },
          },
          transitions: {
              active: {
                  animation: {
                      duration: 400, // ホバー時のアニメーションは400ms
                  }
              },
              // 'resize' (リサイズ時)
              resize: {
                  animation: {
                      duration: 500, // リサイズアニメーションは500ms
                  }
              }
          },
          scales: {
              x: {
                  type: 'linear', // 時間を数値として扱う
                  position: 'bottom',
                  title: {  display: true,
                            text: '経過時間 (秒)'
                  },
                  min: 0,
                  max: 1800, // 30分
                  ticks: {
                    callback: function(value, index, values) {
                        if (!isMinutesSecondsFormat) {
                            return value; // 秒表示
                        }
                        else {
                          return formatSecondsToMinutesSeconds(value);
                        }
                    }
                  }

              },
              y: { // 左側のY軸（温度用）
                  type: 'linear',
                  position: 'left',
                  title: { display: true, text: '温度 (°C)' },
                  min: 0,
                  max: 260
              },
              y1: { // **右側のY軸（RoR用）**
                  type: 'linear',
                  position: 'right',
                  title: { display: true, text: 'RoR (°C/分)' },
                  grid: { drawOnChartArea: false }, // メインのグリッド線を引かない
                  min: -10,
                  max: 50 // RoRの適切な最大値を設定
              }
          },
          plugins: {
              legend: { display: true },
              verticalLinePlugin: { xValue: null } // カスタムプラグインの設定
          },
          // onComplete: drawHeatmapOverlay // ヒートマップは今回は不要、または描画を調整
      },
      plugins: [
          // カスタムプラグインをここに登録
          verticalLinePlugin, // 既存の縦線プラグイン
          smartAIIndicatorPlugin // 追加するスマートAIインジケータープラグイン
      ]
  });
  resizeOverlayCanvas();
}

function chartAreaInitialize() {
  const roastTimeDisplay = document.getElementById('roast_time_area');
  if (roastTimeDisplay) {
    roastTimeDisplay.addEventListener('click', () => {
      isMinutesSecondsFormat = !isMinutesSecondsFormat;
      roastChart.options.scales.x.title.text = !isMinutesSecondsFormat ? '経過時間 (秒)' : '経過時間 (分)';
      roastChart.update();
    });
  }
  const displayMappings = {
      // 'roast_temperature_area': 'currentTemp', 温度表示エリアはクリック無効
      // 'roast_ror_area': 'currentRoR',
      // 'profile_temperature_area': 'profileTemp',
      // 'profile_ror_area': 'profileRoR',
      'currentTime': 'currentTime',
      'currentTemp': 'currentTemp',
      'currentRoR': 'currentRoR',
      'profileTemp': 'profileTemp',
      'profileRoR': 'profileRoR',
  };
  Object.entries(displayMappings).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) {
          el.addEventListener('click', (e) => {
            e.stopPropagation(); // イベントを親の要素に伝えないための防波堤！
            toggleChartDisplay(false);
          });
      }
  });
  const chart_infos_appear_button = document.getElementById('chart-infos-button');
  chart_infos_appear_button.addEventListener('click', (e) => {
    e.stopPropagation(); // イベントを親の要素に伝えないための防波堤！
    const bt = window.getComputedStyle(chart_infos_appear_button);
    const bt_value = parseFloat(bt.opacity);
    if(bt_value > 0.7){
      toggleChartDisplay(true);
    }
    else{
      toggleChartDisplay(false);
    }
  });

  initChart();
  document.getElementById('stop-button').disabled = true;
  roastChart.resize();
}

function parseCSV(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) throw "CSVに有効なデータがありません";

  const header = lines[0].trim().split(/[\s,]+/);
  if (header.length < 2 || !header[0].toLowerCase().includes("time") || !header[1].toLowerCase().includes("temp")) {
    throw "CSVのヘッダーが 'time temp' 形式ではありません";
  }

  const profile = lines.slice(1).map((line, idx) => {
    const parts = line.trim().split(/[\s,]+/);
    if (parts.length < 2) throw `CSVの${idx + 2}行目に問題があります`;

    const time = parseFloat(parts[0]);
    const temp = parseFloat(parts[1]);

    if (isNaN(time) || isNaN(temp)) throw `${idx + 2}行目に数値でない値があります`;

    return { time, temp };
  });

  return {
    title: "",
    memo: "",
    profile
  };
}

function parseAlogManualScan(alogText, title = "未設定", memo = "") {
  function extractArray(key) {
    const pattern = new RegExp(`'${key}'\\s*:\\s*\\[(.*?)\\]`, 's');
    const match = alogText.match(pattern);
    if (!match) return [];
    return match[1]
      .split(',')
      .map(s => parseFloat(s.trim()))
      .filter(v => !isNaN(v));
  }

  const timexArray = extractArray("timex");
  const temp1Array = extractArray("temp1");
  const length = Math.min(timexArray.length, temp1Array.length, 1799);

  const profile = [];
  for (let i = 0; i < length; i++) {
    profile.push({
      time: Math.round(timexArray[i]),
      temp: Math.round(temp1Array[i] * 10) / 10
    });
  }

  return {
    type: "roast_profile",
    title: title,
    memo: memo,
    profile: profile
  };
}

// SmartAIIndicator プラグイン
const smartAIIndicatorPlugin = {
  id: 'smartAIIndicator',
  afterDraw(chart, args, options) {
    const { ctx, chartArea, scales } = chart;
    const profileDataset = chart.data.datasets[0]; // 設定温度プロファイル
    const liveTempDataset = chart.data.datasets[1]; // リアルタイム温度
    const rorDataset = chart.data.datasets[3]; // RoRデータセット

    // プロファイルが表示されてなかったらインジケーターは表示しない
    if (!liveTempDataset || liveTempDataset.data.length === 0 || !profileDataset || profileDataset.data.length === 0 || !isRoasting) {
        return;
    }

    ctx.save();
    ctx.translate(chartArea.left, chartArea.top);

    const latestLivePoint = liveTempDataset.data[liveTempDataset.data.length - 1];
    const currentTime = latestLivePoint.x;
    const currentTemp = latestLivePoint.y;

    const targetTemp = getInterpolatedProfileTemp(getProfileDataFromTable(), currentTime);
    //const targetRoR = getInterpolatedProfileRoR(getProfileDataFromTable(), currentTime); // 目標RoRを取得
    const targetRoR = calculateRoR(getProfileDataFromTable(), currentTime); // 目標RoRを取得
    const currentRoR = calculateRoR(liveTempDataset.data); 
    const acceleration = calculateAcceleration(liveTempDataset.data, 30, 60); // 加速度を取得

    // if (targetTemp === null || targetRoR === null) {
    //     ctx.restore();
    //     return;
    // }

    const tempDifference = currentTemp - targetTemp;
    const indicatorColor = getColorForTemperatureDifference(tempDifference); // ここで透明度を調整しない
    const indicatorRadius = getRadiusForTemperatureDifference(tempDifference);

    // 1. ヒートマップ円の描画
    moveImageAt(currentTime, currentTemp, indicatorRadius * 2, setHslaAlpha(indicatorColor, 0.6));
    updateArrowPositionAndRotation(roastChart, currentTime, currentTemp, 5);
    
    ShowChartIndicators();

    ctx.restore();
   
  }
};

/**
 * プロファイルデータから指定された時間における温度を線形補間して取得します。
 * @param {Array<Object>} profileData - { x: time, y: temp } 形式のプロファイルデータ配列。
 * @param {number} currentTime - 補間したい時間。
 * @returns {number|null} 補間された温度、またはデータ不足の場合はnull。
 */
function getInterpolatedProfileTemp(profileData, currentTime) {
  if (profileData.length === 0) return null;

  if (currentTime <= profileData[0].time) {
      return parseFloat(profileData[0].temp);
  }
  if (currentTime >= profileData[profileData.length - 1].time) {
      return parseFloat(profileData[profileData.length - 1].temp);
  }

  for (let i = 0; i < profileData.length - 1; i++) {
    const p1 = profileData[i];
    const p2 = profileData[i + 1];
    if (currentTime >= p1.time && currentTime <= p2.time) {
        const t1 = parseFloat(p1.temp);
        const t2 = parseFloat(p2.temp);
        const ratio = (currentTime - p1.time) / (p2.time - p1.time);
        const res = t1 + (t2 - t1) * ratio;
        return res;
    }
  }

  return null;
}

/**
 * 温度差に基づいてHSLカラーコードを生成します。
 * 緑（G）が適温、正の差は赤（R）へ、負の差は青（B）へ近づきます。
 * @param {number} tempDiff - リアルタイム温度と目標温度の差。
 * @returns {string} HSLカラーコード文字列。
 */
function getColorForTemperatureDifference(tempDiff) {
    const maxDiff = 20; // ±10度で色が大きく変化すると仮定 (調整可能)
    const minDiff = -20;

    // 差を-1から1の範囲に正規化
    let normalizedDiff = (tempDiff - minDiff) / (maxDiff - minDiff);
    normalizedDiff = Math.max(0, Math.min(1, normalizedDiff)); // 0から1にクランプ

    // HSLの色相(Hue)を計算
    // 0(赤) -- 120(緑) -- 240(青)
    // 0.5（適温）が緑(120)、1（高温）が赤(0)、0（低温）が青(240) になるようにマッピング
    // Hueは角度なので、円形に変化させる（例：240を起点に-120～+120の範囲で）
    const hue = (1 - normalizedDiff) * 240; // 0が青(240)、0.5が緑(120)、1が赤(0)

    // 彩度と明度を固定 (必要に応じて調整)
    const saturation = '100%';
    const lightness = '50%'; // 明るさ
    
    return `hsl(${hue.toFixed(0)}, ${saturation}, ${lightness}, 0.6)`;
}

let isCompareProfileShown = false;

function copyProfileChartToCompare(chart = roastChart) {
    const btn = document.getElementById('button-copy-profile');
    if (!chart) return;
    // 比較用データセットのインデックスを探す
    const compareIndex = chart.data.datasets.findIndex(ds => ds.label === '比較用プロファイル');

    if (!isCompareProfileShown && compareIndex === -1) {
        // 追加
        const profileData = getProfileDataFromTable();
        if (!profileData || profileData.length === 0) return;
        chart.data.datasets.push({
            label: '比較用プロファイル',
            data: profileData.map(p => ({ x: p.time, y: p.temp })),
            borderColor: 'rgba(52, 181, 89, 0.7)',
            backgroundColor: 'rgba(0, 104, 61, 0.04)',
            borderWidth: 2, //1,
            pointRadius: 0, //2,
            fill: true,
            tension: 0.01,
            order: 15
        });
        isCompareProfileShown = true;
        if (btn) btn.textContent = "📈 比較プロファイル解除";
    } 
    else if (isCompareProfileShown && compareIndex !== -1) {
        // 削除
        chart.data.datasets.splice(compareIndex, 1);
        isCompareProfileShown = false;
        if (btn) btn.textContent = "📈 比較プロファイル表示";
    }
    chart.update();
}

/**
 * hsl() または hsla() カラーコード文字列の透明度 (アルファ値) を変更します。
 * 既存のアルファ値があれば上書きし、なければ新たにアルファ値を追加します。
 *
 * @param {string} hslColorString - 変更したい 'hsl(...)' または 'hsla(...)' 形式の文字列。
 * @param {number} newAlpha - 設定したい新しい透明度 (0.0 から 1.0 の範囲)。
 * @returns {string} 新しい 'hsla(...)' 形式の文字列。
 */
function setHslaAlpha(hslColorString, newAlpha) {
    // 正規表現で hsl() または hsla() の括弧内の値 (H, S, L, [A]) を抽出
    const match = hslColorString.match(/hsla?\((\d+),\s*([\d.]+%?),\s*([\d.]+%?)(?:,\s*([\d.]+))?\)/);

    if (!match) {
        console.error("Invalid HSL/HSLA color string format:", hslColorString);
        return hslColorString; // 無効なフォーマットの場合は元の文字列を返す
    }

    // 抽出した値を変数に格納
    const hue = match[1];
    const saturation = match[2];
    const lightness = match[3];

    // 新しいアルファ値で hsla() 文字列を構築
    return `hsla(${hue}, ${saturation}, ${lightness}, ${newAlpha})`;
}

/**
 * 温度差に基づいて円の半径を計算します。
 * 差の絶対値が大きいほど半径が大きくなります。
 * @param {number} tempDiff - 温度差。
 * @returns {number} 円の半径（ピクセル）。
 */
function getRadiusForTemperatureDifference(tempDiff) {
    const absDiff = Math.abs(tempDiff);
    const minRadius = 5;  // 適温時の最小半径
    const maxRadius = 20; // 最大乖離時の最大半径
    const diffScale = 20;  // この値で乖離の大きさが半径に与える影響を調整

    // 差が小さいときは最小半径、差が大きいほど最大半径に近づく
    // 線形に増加させる
    return Math.min(maxRadius, minRadius + (absDiff / diffScale) * (maxRadius - minRadius));
}

/**
 * プロファイルデータから指定された時間におけるRoRをN秒間の移動平均で取得します。
 * 現在時間とその前後を含めたN秒間のデータを使って平均RoRを計算します。
 *
 * @param {Array<Object>} profileData - { time: number, temp: number } 形式のプロファイルデータ配列。
 * @param {number} currentTime - 目標RoRを計算したい現在の時間 (秒)。
 * @param {number} periodSeconds - 移動平均RoRの計算に使う期間 (秒)。デフォルトは20秒。
 * @param {number} halfposition - 現在の位置を基準にするためのオフセット (デフォルトは0（現在位置よりperiodSeconds分前から計算）)。
 * @returns {number|null} 計算されたRoR (°C/分)、またはデータ不足の場合はnull。
 */
function getInterpolatedProfileRoR(profileData, currentTime, periodSeconds = 20, halfposition = 0) {
    if (profileData.length < 2) return null;

    if (halfposition < 0) { halfposition = 0; }
    else if (halfposition > periodSeconds) { halfposition = periodSeconds; }
    // RoR計算の開始時間と終了時間
    const startTime = (currentTime - (periodSeconds - halfposition)).toFixed(0);
    const endTime = (currentTime + halfposition).toFixed(0);

    if (startTime < 1) {
      return null;
    }
    else if (endTime > profileData.length - 1) {
      return null;
    }

    // 計算期間内のデータポイントをフィルタリング
    // 期間内の最初の点と最後の点を確実に見つけるために、フィルタリング範囲を広げる
    const relevantPoints = profileData.filter(p => p.time >= startTime - 1 && p.time <= endTime + 1);

    // フィルタリングされたデータがRoR計算に不十分な場合
    if (relevantPoints.length < 2) {
        // 例えば、プロファイルの最初や最後でデータが不足する場合
        if (currentTime <= profileData[0].time + periodSeconds) {
            // プロファイルの最初から periodSeconds 以内の場合、最初の2点を使う
            const p1 = profileData[0];
            const p2 = profileData[1];
            const dt = p2.time - p1.time;
            const dT = p2.temp - p1.temp;
            return null; //dt > 0 ? (dT / dt) * 60 : 0;
        } else if (currentTime >= profileData[profileData.length - 1].time - periodSeconds) {
            // プロファイルの最後から periodSeconds 以内の場合、最後の2点を使う
            const p1 = profileData[profileData.length - 2];
            const p2 = profileData[profileData.length - 1];
            const dt = p2.time - p1.time;
            const dT = p2.temp - p1.temp;
            return null; // dt > 0 ? (dT / dt) * 60 : 0;
        }
        return null; // それでもデータが不十分ならnull
    }

    // 計算期間内の最初の点と最後の点の時間と温度を補間して取得
    // これにより、正確に startTime と endTime における温度が得られる
    const startTemp = getInterpolatedProfileTemp(profileData, startTime);
    const endTemp = getInterpolatedProfileTemp(profileData, endTime);

    // RoR計算の期間が0になるのを防ぐ
    const actualDt = endTime - startTime;

    if (actualDt > 0 && startTemp !== null && endTemp !== null) {
        const actualDtTemp = endTemp - startTemp;
        return (actualDtTemp / actualDt) * 60; // °C/min に変換
    }

    return null; // 計算できない場合は0を返す (またはnull)
}

/**
 * リアルタイム温度データから、指定期間（periodSeconds）内のデータに対する線形回帰を用いてRoRを計算します。
 * これは、N個のデータポイントの移動平均 RoR の一種として機能し、ノイズに強いです。
 *
 * @param {Array<Object>} data - { x: time, y: temp } 形式のリアルタイム温度データ。
 * @param {number} periodSeconds - RoR計算に使う期間（秒）。
 * @returns {number} 現在のRoR (°C/min)。計算に必要なデータが不足している場合は0。
 */
function calculateRoR(data, position = -1, periodSeconds = 20) {
    if (data.length < 2) return 0; // 最低2点は必要
    let currentPointTime;
    if (position == -1) {
      currentPointTime = data[data.length - 1].x;
    } 
    else {
      currentPointTime = position;
    }
    const startTime = currentPointTime - periodSeconds;

    // 計算期間内のデータポイントをフィルタリング
    // 線形回帰には少なくとも2点必要
    const relevantPoints = data.filter(p => p.x >= startTime && p.x < currentPointTime);

    if (relevantPoints.length < 2) {
        return 0; // データが不足している場合は0を返す
    }

    // 線形回帰の計算に必要な変数を初期化
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;
    const n = relevantPoints.length; // データポイントの数

    // 各データポイントに対して計算
    for (const p of relevantPoints) {
        sumX += p.x;
        sumY += p.y;
        sumXY += p.x * p.y;
        sumXX += p.x * p.x;
    }

    // 線形回帰の傾き (b) を計算
    // b = (n * sum(xy) - sum(x) * sum(y)) / (n * sum(x^2) - (sum(x))^2)
    const denominator = (n * sumXX - sumX * sumX);

    if (denominator === 0) {
        return 0; // 分母が0になる場合は傾きを計算できない（すべてのxが同じ値など）
    }

    const slope = (n * sumXY - sumX * sumY) / denominator;

    // 傾きは °C/秒 なので、°C/分 に変換
    return slope * 60; // °C/min
}

/**
 * リアルタイム温度データから加速度を計算します。
 * (RoRのRoR、つまりRoRの変化率)
 * @param {Array<Object>} liveData - { x: time, y: temp } 形式のリアルタイム温度データ。
 * @param {number} rorPeriodSeconds - RoR計算に使う期間（秒）。
 * @param {number} accelerationPeriodSeconds - 加速度計算に使うRoRの期間（秒）。
 * @returns {number} 加速度 (°C/min^2)。データ不足の場合は0。
 */
function calculateAcceleration(liveData, rorPeriodSeconds = 30, accelerationPeriodSeconds = 60) {
    if (liveData.length < 3) return 0; // 加速度計算には最低3点（RoRを2回計算するため）

    // 現在のRoR
    const currentRoR = calculateRoR(liveData, rorPeriodSeconds);

    // 加速度計算のために、少し前の時点でのRoRを計算
    const currentPointTime = liveData[liveData.length - 1].x;
    let pastTimeForRoR = null;

    for (let i = liveData.length - 2; i >= 0; i--) {
        if (currentPointTime - liveData[i].x >= accelerationPeriodSeconds) {
            pastTimeForRoR = liveData[i].x;
            break;
        }
    }

    if (pastTimeForRoR === null) return 0; // 十分な過去データがない

    // 過去のRoR計算に必要なデータ点をフィルタリング
    const pastRoRData = liveData.filter(p => p.x <= pastTimeForRoR);
    if (pastRoRData.length < 2) return 0;

    const prevRoR = calculateRoR(pastRoRData, rorPeriodSeconds);

    const timeDiffRoR = currentPointTime - pastTimeForRoR; // RoR間の時間差（秒）
    
    return timeDiffRoR > 0 ? (currentRoR - prevRoR) / (timeDiffRoR / 60) : 0; // °C/min^2
}

/**
 * 矢印の長さと角度を計算します。
 * @param {number} currentTemp - 現在のリアルタイム温度。
 * @param {number} targetTemp - 目標プロファイル温度。
 * @param {number} currentRoR - 現在のリアルタイムRoR。
 * @param {number} targetRoR - 目標プロファイルRoR。
 * @param {number} acceleration - 現在のRoRの加速度。
 * @returns {{length: number, angle: number}} 矢印の長さ（ピクセル）と角度（ラジアン）。
 */
function calculateArrowVector(currentTemp, targetTemp, currentRoR, targetRoR, acceleration) {
    const maxArrowLength = 60; // 矢印の最大長さ (ピクセル)
    const minArrowLength = 10; // 矢印の最小長さ (適温時)
    
    let length = minArrowLength;
    let angleDegrees = 0; // 初期角度：0度 = 右方向（時間軸の正方向）

    // --- 1. 温度差に基づく基本の角度と長さ ---
    const tempDiff = currentTemp - targetTemp; // 正なら高い、負なら低い
    const tempDiffThreshold = 2; // ±2度以内は「適温」とみなす閾値

    if (Math.abs(tempDiff) > tempDiffThreshold) {
        // 温度差が大きいほど矢印を長くする
        length = Math.min(maxArrowLength, minArrowLength + Math.abs(tempDiff) * 5);

        if (tempDiff < 0) { // 現在温度が目標より低い（上げる必要がある）
            angleDegrees = -90; // 基本は上向き
        } else { // 現在温度が目標より高い（下げる必要がある）
            angleDegrees = 90; // 基本は下向き
        }
    } else {
        // 適温範囲内では、長さは最小、角度はRoRに基づいて調整
        length = minArrowLength;
        angleDegrees = 0; // 基本は横向き
    }

    // --- 2. RoR差に基づく角度の調整 ---
    const rorDiff = currentRoR - targetRoR; // 正ならRoRが高い、負なら低い
    const rorDiffThreshold = 1; // ±1°C/min 以内は許容範囲

    if (Math.abs(rorDiff) > rorDiffThreshold) {
        // RoR差が大きいほど矢印の長さをさらに伸ばす
        length = Math.min(maxArrowLength, length + Math.abs(rorDiff) * 3);

        // RoRが目標より低いのに、温度も低いなら、さらに上方向へ
        // RoRが目標より高いのに、温度も高いなら、さらに下方向へ
        // （つまり、乖離方向とRoR乖離方向が一致するなら、その方向を強める）
        if (tempDiff < 0 && rorDiff < 0) { // 温度もRoRも低い
            angleDegrees = Math.max(-135, angleDegrees - 30); // さらに上向きに
        } else if (tempDiff > 0 && rorDiff > 0) { // 温度もRoRも高い
            angleDegrees = Math.min(135, angleDegrees + 30); // さらに下向きに
        } else if (tempDiff < 0 && rorDiff > 0) { // 温度低いがRoR高い (RoR下げて温度上げたい)
            // 少し斜め上右のような調整
            angleDegrees = Math.min(-30, angleDegrees + 10); // 上向きだが少し傾ける
        } else if (tempDiff > 0 && rorDiff < 0) { // 温度高いがRoR低い (RoR上げて温度下げたい)
            // 少し斜め下右のような調整
            angleDegrees = Math.max(30, angleDegrees - 10); // 下向きだが少し傾ける
        } else {
            // 温度が適温だがRoRが乖離している場合
            if (rorDiff < 0) angleDegrees = -45; // RoR低いなら斜め上右
            if (rorDiff > 0) angleDegrees = 45; // RoR高いなら斜め下右
        }
    }

    // --- 3. 加速度に基づく調整 (微調整) ---
    // 加速度は、RoRが目標に「近づいている」か「遠ざかっている」かの傾向を示す
    const accelerationThreshold = 0.5; // °C/min^2
    if (Math.abs(acceleration) > accelerationThreshold) {
        // RoRが目標より低い (-rorDiff) のに、加速中 (+acceleration) なら、矢印を少し緩める
        // RoRが目標より高い (+rorDiff) のに、減速中 (-acceleration) なら、矢印を少し緩める
        // つまり、RoRが目標に向かって変化しているなら、矢印の緊急度を少し下げる
        if (rorDiff < 0 && acceleration > 0) { // RoR低いが加速中
            length = Math.max(minArrowLength, length - 10); // 少し短く
            // angleDegrees = Math.max(-110, angleDegrees + 10); // 少し上向きを緩める
        } else if (rorDiff > 0 && acceleration < 0) { // RoR高いが減速中
            length = Math.max(minArrowLength, length - 10); // 少し短く
            // angleDegrees = Math.min(110, angleDegrees - 10); // 少し下向きを緩める
        } else if (rorDiff < 0 && acceleration < 0) { // RoR低く、さらに減速中（緊急！）
            length = Math.min(maxArrowLength, length + 10); // さらに長く
            // angleDegrees = Math.min(-140, angleDegrees - 10); // さらに上向きに
        } else if (rorDiff > 0 && acceleration > 0) { // RoR高く、さらに加速中（緊急！）
            length = Math.min(maxArrowLength, length + 10); // さらに長く
            // angleDegrees = Math.max(140, angleDegrees + 10); // さらに下向きに
        }
    }

    // 最終的な角度をラジアンに変換
    const angleRadians = angleDegrees * (Math.PI / 180);

    return { length, angle: angleRadians };
}

// 指定したチャート座標に画像を追加する関数
function moveImageAt(xValue, yValue, size, color) {
    const xy = translateChartCoordinate(roastChart, xValue, yValue);
    // 画像要素を作成
    const img = document.getElementById('chart-point');
    img.style.left = (xy.x - img.offsetWidth / 2) + 'px'; // 中央揃え
    img.style.top = (xy.y - img.offsetHeight / 2) + 'px';  // 中央揃え
    img.style.width = size + 'px'; // サイズを指定
    img.style.height = size + 'px'; // サイズを指定
    img.style.backgroundColor = color; // 色を指定
}

// 指定したチャート座標に画像を追加する関数
function translateChartCoordinate(chart, xValue, yValue) {
    // チャート座標をピクセル座標に変換
    const xPixel = chart.scales.x.getPixelForValue(xValue);
    const yPixel = chart.scales.y.getPixelForValue(yValue);
    
    // キャンバスの位置を取得
    const canvasRect = chart.canvas.getBoundingClientRect();
    const containerRect = chart.canvas.parentElement.getBoundingClientRect();
    
    // HTML絶対座標に変換（コンテナ基準）
    const absoluteX = xPixel + (canvasRect.left - containerRect.left);
    const absoluteY = yPixel + (canvasRect.top - containerRect.top);
    
    return { x: absoluteX, y: absoluteY };
}

/**
 * 矢印要素の位置と回転を更新します。
 *
 * @param {object} chart - Chart.jsのチャートインスタンス
 * @param {number} currentTime - 現在のチャート上の時間（X軸の値）
 * @param {number} currentTemp - 現在のチャート上の温度（Y軸の値）
 * @param {number} historyCount - 矢印の方向計算に使用する過去のデータポイント数（N）
 * @param {number} [arrowLength=30] - 矢印の長さ（ピクセル）。デフォルトは30px。
 */
function updateArrowPositionAndRotation(chart, currentTime, currentTemp, historyCount, arrowLength = 30) {
    const arrowElement = document.getElementById('chart-arrow');
    const rorDataset = chart.data.datasets[1];

    if (!arrowElement || !rorDataset || rorDataset.data.length === 0) {
        arrowElement.style.display = 'none'; // 非表示にする
        return;
    }
    // --- 1. 現在のデータポイントのピクセル座標を取得 ---
    const currentPixelPos = translateChartCoordinate(chart, currentTime, currentTemp);
    // --- 2. 過去N回分の平均データポイントを計算 ---
    let pastXSum = 0;
    let pastYSum = 0;
    const dataPoints = rorDataset.data;
    const startIndex = Math.max(0, dataPoints.length - historyCount); // 過去N個分の開始インデックス

    if (startIndex >= dataPoints.length) {
        // データがN個未満の場合も非表示
        arrowElement.style.display = 'none';
        return;
    }

    let validCount = 0;
    for (let i = startIndex; i < dataPoints.length; i++) {
        pastXSum += dataPoints[i].x;
        pastYSum += dataPoints[i].y; // RoRのY値を直接使用するか、またはTempを使用するかは要検討
        validCount++;
    }

    if (validCount === 0) {
        arrowElement.style.display = 'none';
        return;
    }

    const avgPastX = pastXSum / validCount;
    const avgPastY = pastYSum / validCount;

    const avgPastPixelPos = translateChartCoordinate(chart, avgPastX, avgPastY);

    // --- 4. ベクトル（方向）を計算 ---
    // (現在の点) - (過去の平均点)
    const deltaX = currentPixelPos.x - avgPastPixelPos.x;
    const deltaY = currentPixelPos.y - avgPastPixelPos.y;
    const angleRad = Math.atan2(deltaY, deltaX);
    const angleDeg = angleRad * (180 / Math.PI); // ラジアンを度に変換
    const arrowWidth = arrowElement.offsetWidth;
    const arrowHeight = arrowElement.offsetHeight;

    // 矢印の中心（デフォルトのtransform-origin: 50% 50%）を現在の点に合わせる
    // X軸は左端、Y軸は上端を基準とするため、Y軸は要素の半分を引く
    arrowElement.style.left = `${currentPixelPos.x }px`;
    arrowElement.style.top = `${currentPixelPos.y - arrowHeight / 2}px`;
    const rotation = angleDeg; // 基本の回転
    arrowElement.style.transform = `rotate(${rotation}deg)`;
}

// オーバーレイCanvasのコンテキストを一度取得しておく
const overlayCanvas = document.getElementById('overlayCanvas');
const overlayCtx = overlayCanvas ? overlayCanvas.getContext('2d') : null;

// CanvasのサイズをメインチャートのCanvasと同じにする関数 (リサイズ対応)
function resizeOverlayCanvas() {
    overlayCanvas.width = roastChart.canvas.width;
    overlayCanvas.height = roastChart.canvas.height;
    const dpr = window.devicePixelRatio || 1;
    // 描画コンテキストを毎回リセットし、DPRスケールを適用する
    overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

// --- Helper to get pixel coordinates ---
function getChartPixelCoordinates(chart, dataPoint) {
    if (!chart || !dataPoint || isNaN(dataPoint.x) || isNaN(dataPoint.y)) {
        return null;
    }
    const xPixel = chart.scales.x.getPixelForValue(dataPoint.x);
    const yPixel = chart.scales.y.getPixelForValue(dataPoint.y);
    return { x: xPixel, y: yPixel };
}

/**
 * 現在温度地点から焙煎プロファイル上の目標点へ補助線を引き、矢印を調整する
 * @param {Chart} chart Chart.jsインスタンス
 * @param {object} currentTempData 現在温度のデータ点 {x: time, y: temp}
 * @param {Array<object>} profileData 焙煎プロファイルのデータ配列 [{x: time, y: temp}, ...]
 */
function updateCorrectionVisuals(chart, currentTempData, profileData) {
    if (!currentTempData || !profileData || profileData.length === 0) { // プロファイルがロードされていない
        return;
    }

    // 3. 焙煎プロファイル上の目標点を特定
    // ここでは「現在の時間から少し未来の目標プロファイルの点」を目指すアプローチを取ります
    // 例: 現在時間から +10秒後のプロファイル上の点を目標とする
    const targetLookAheadSeconds = 20; // 調整可能な秒数
    const targetTime = currentTempData.x + targetLookAheadSeconds;

    // プロファイルデータから目標時間に対応する温度を見つける (線形補間)
    let targetTemp = null;
    let targetDataPoint = null;

    // プロファイルデータが時間でソートされていることを前提とします
    for (let i = 0; i < profileData.length; i++) {
        if (profileData[i].x === targetTime) {
            targetTemp = profileData[i].y;
            targetDataPoint = profileData[i];
            break;
        } else if (profileData[i].x > targetTime) {
            // 線形補間
            if (i > 0) {
                const prevPoint = profileData[i-1];
                const nextPoint = profileData[i];
                targetTemp = prevPoint.y + (nextPoint.y - prevPoint.y) * ((targetTime - prevPoint.x) / (nextPoint.x - prevPoint.x));
                targetDataPoint = { x: targetTime, y: targetTemp };
            } else {
                // targetTimeがプロファイルの最初より前の場合、最初の点を目標とする
                targetDataPoint = profileData[0];
            }
            break;
        }
    }
    // もしtargetTimeがプロファイルの最後を超えていたら、プロファイルの最終点を目標とする
    if (targetDataPoint === null && profileData.length > 0) {
        targetDataPoint = profileData[profileData.length - 1];
        targetDataPoint.x = chart.scales.x.max; // 最後の時間を最大値に設定
    }

    if (!targetDataPoint) {
        console.warn("Could not find a valid target point on the profile.");
        return;
    }

    drawTargetDashLine(currentTempData, targetDataPoint, roastChart);
  }

let lastCurrentPoint = null;
/**
 * 現在温度地点からターゲットポイントを通ってチャートの端まで破線を描画する関数
 * @param {object} currentChartPointData 現在温度地点の {x: 時間, y: 温度} データ値
 * @param {object} targetChartPointData 目標点の {x: 時間, y: 温度} データ値
 * @param {Chart} chart Chart.jsインスタンス
 */
function drawTargetDashLine(currentChartPointData, targetChartPointData, chart) {
    if (!overlayCtx || !overlayCanvas || !chart) {
        console.error("Overlay Canvas, Context, または Chart インスタンスが利用できません。");
        return;
    }

    // データ値のバリデーション
    if (!currentChartPointData || !targetChartPointData ||
        isNaN(currentChartPointData.x) || isNaN(currentChartPointData.y) ||
        isNaN(targetChartPointData.x) || isNaN(targetChartPointData.y)) {
        console.warn("線描画のためのデータが無効です。");
        return;
    }

    const currentPx = getChartPixelCoordinates(chart, currentChartPointData);
    const targetPx = getChartPixelCoordinates(chart, targetChartPointData);

    // --- ここから線の終点計算ロジック ---
    const dx = targetPx.x - currentPx.x;
    const dy = targetPx.y - currentPx.y;
    const chartArea = chart.chartArea; // Chart.js 2.x/3.x/4.x で共通

    function calculateLineEndPoint(startPx, dx, dy, chartArea) {
        // ベクトルが0（点が重なっている）場合は、終点も始点と同じ
        if (dx === 0 && dy === 0) {
            return startPx;
        }
        let t = Infinity; // パラメータ t
        if (dx !== 0) {
            const tx1 = (chartArea.left - startPx.x) / dx;
            const tx2 = (chartArea.right - startPx.x) / dx;
            if (dx > 0) t = Math.min(t, tx2); // 右方向へ進むなら右境界
            else t = Math.min(t, tx1);      // 左方向へ進むなら左境界
        }
        if (dy !== 0) {
            const ty1 = (chartArea.top - startPx.y) / dy;
            const ty2 = (chartArea.bottom - startPx.y) / dy;
            if (dy > 0) t = Math.min(t, ty2); // 下方向へ進むなら下境界
            else t = Math.min(t, ty1);      // 上方向へ進むなら上境界
        }
        if (t === Infinity || isNaN(t)) {
            return startPx; // 始点と同じ点を返すか、描画しないなどの処理
        }
        t = Math.max(t, 1); // targetPxを必ず含むようにする
        
        const mag = 100;
        return {
            x: startPx.x + dx * t * mag,
            y: startPx.y + dy * t * mag
        };
    }

    const endPx = calculateLineEndPoint(currentPx, dx, dy, chartArea);

    animateDashLine(currentPx, endPx); 
}

function drawDashLinePhysical(currentPx, endPx) {
    resizeOverlayCanvas();

    overlayCtx.save(); 
    overlayCtx.beginPath();
    overlayCtx.rect(roastChart.chartArea.left, roastChart.chartArea.top, roastChart.chartArea.width, roastChart.chartArea.height);
    overlayCtx.clip(); // ここでクリッピングを適用

    overlayCtx.beginPath();
    overlayCtx.strokeStyle = 'rgba(0, 0, 0, 0.7)'; 
    overlayCtx.lineWidth = 2;
    overlayCtx.setLineDash([5, 5]);
    overlayCtx.moveTo(currentPx.x, currentPx.y);
    overlayCtx.lineTo(endPx.x, endPx.y); // 現在点から計算した端の点まで描画
    overlayCtx.stroke();
    overlayCtx.setLineDash([]); // 破線モードをリセット
    overlayCtx.restore();
}

let animationStartTime = null;
let last_endPx = null; 
// 現在の線の終点座標（アニメーションの開始点）を保持する変数
let currentLineEndPoint = null; // 例: { x: 100, y: 100 }
let AnimationIntervalID = null;
let DashLineAnimationEndData_S = null;
let DashLineAnimationEndData_E = null;
let DashLineAnimationStartData_S = null;
let DashLineAnimationStartData_E = null;

// アニメーションをトリガーする関数
/**
 * 補助線の描画をアニメーションさせる
 * @param {object} startDataPoint アニメーションの開始データ点 {x, y}
 * @param {object} endDataPoint アニメーションの最終データ点 {x, y} (目標プロファイル上の点)
 */
function animateDashLine(startDataPoint, endDataPoint) {
    if (AnimationIntervalID != null) {
        clearInterval(AnimationIntervalID); // 既存のアニメーションをクリア
    }
    animationStartTime = 0.01;

    // アニメーションの開始データ点と終了データ点を設定
    if (DashLineAnimationEndData_E === null) {
      DashLineAnimationEndData_S = endDataPoint;
      DashLineAnimationStartData_S = startDataPoint; // 現在温度地点のデータ点
    }
    else {
      DashLineAnimationEndData_S = DashLineAnimationEndData_E;
      DashLineAnimationStartData_S = DashLineAnimationStartData_E;
    }
    DashLineAnimationEndData_E = endDataPoint;  
    DashLineAnimationStartData_E = startDataPoint;  
    AnimationIntervalID = setInterval(() => {
      animate100ms();
    }, 100);

}

// アニメーションループを開始
function animate100ms() {
    if (animationStartTime > 0.0) {
      animationStartTime += 0.09;
    }

    let progress = Math.min(animationStartTime, 1); // 0から1の進行度
    progress = easeInOutQuad(progress); 
    if (progress >= 1.0) {
      animationStartTime = null; // アニメーションをリセット
      clearInterval(AnimationIntervalID); // アニメーションを停止
      AnimationIntervalID = null; // IDをリセット
      return;
    }

    // 補間されたデータ値を計算
    const interpolatedEndDataX = DashLineAnimationEndData_S.x + (DashLineAnimationEndData_E.x - DashLineAnimationEndData_S.x) * progress;
    const interpolatedEndDataY = DashLineAnimationEndData_S.y + (DashLineAnimationEndData_E.y - DashLineAnimationEndData_S.y) * progress;
    const interpolatedStartDataX = DashLineAnimationStartData_S.x + (DashLineAnimationStartData_E.x - DashLineAnimationStartData_S.x) * progress;
    const interpolatedStartDataY = DashLineAnimationStartData_S.y + (DashLineAnimationStartData_E.y - DashLineAnimationStartData_S.y) * progress;

    drawDashLinePhysical({ x: interpolatedStartDataX, y: interpolatedStartDataY }, { x: interpolatedEndDataX, y: interpolatedEndDataY });
}

// イージング関数 (例: quadInOut - 緩やかに加速し、緩やかに減速する)
function easeInOutQuad(t) {
    t *= 2;
    if (t < 1) return 0.5 * t * t;
    return -0.5 * (--t * (t - 2) - 1);
}

//■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
// Version.1.0.0
//■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
