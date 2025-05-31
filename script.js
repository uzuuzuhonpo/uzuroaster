const textarea = document.getElementById('profileMemo');
const popup = document.getElementById('popupTextarea');
const popupText = document.getElementById('popupText');
const closeButton = document.getElementById('closePopup');
const popupOverlay = document.getElementById('popupOverlay');

let roastChart = null;
const profile_color = 'rgba(80,80,80,0.4)'; // プロファイルの色 
const active_profile_color = 'rgba(136, 184, 221, 0.8)'; // アクティブプロファイルの色  
let isMinutesSecondsFormat = false; // 初期値は秒表示
let widthOffset = 0; // グラフの幅調整用オフセット
let maxChartWidth = 1800; // グラフの最大幅
let ProfileSecondData = []; // 1秒間隔のプロファイルデータ

window.addEventListener('resize', () => {
  if (roastChart) {
    roastChart.resize();
    resizeOverlayCanvas();
  }
});

/*
let isFullscreen2 = false;
const chartWrapper = document.getElementById('chart-area');
const tableContents = document.getElementById('table_contents');
chartWrapper.addEventListener('click', () => {
  isFullscreen2 = !isFullscreen2;
  chartWrapper.classList.toggle('fullscreen', isFullscreen2);
  tableContents.style.display = isFullscreen2 ? 'none' : 'block';
});
*/
let isFullscreen = false;
const chartCanvas = document.getElementById('chart-area');
chartCanvas.addEventListener('click', () => {
  if (!isFullscreen) {
    document.getElementById('table_contents').style.display="none";
    document.getElementById('main-area2').style.height="100%";
    isFullscreen = true;
	const targetDOMRect = chartCanvas.getBoundingClientRect();
	const targetTop = targetDOMRect.top + window.pageYOffset;
setTimeout(() => {
  window.scrollTo({ top: targetTop, behavior: 'smooth' });
}, 100); // 100msくらいが安定
  } else {
    document.getElementById('table_contents').style.display="flex";
    document.getElementById('main-area2').style.height="500px";
    isFullscreen = false;
  }
});

        textarea.addEventListener('click', () => {
            popupText.value = textarea.value;
            popup.classList.add('show');
            popupOverlay.classList.add('show');
            // ポップアップ表示時にテキストエリアにフォーカスを当てる
            popupText.focus();
        });

        closeButton.addEventListener('click', () => {
            textarea.value = popupText.value;
            popup.classList.remove('show');
            popupOverlay.classList.remove('show');
        });

        popupOverlay.addEventListener('click', () => {
            textarea.value = popupText.value;
            popup.classList.remove('show');
            popupOverlay.classList.remove('show');
        });

let socket = null;
connectWebSocket();
const pendingResponses = new Map();
const liveData = [];
let isRoasting = false;

socket.onopen = () => {
		updateConnectionStatus(true);
	console.log("WebSocket接続");
	};
socket.onclose = () => {  
	updateConnectionStatus(false);
	console.log("WebSocket切断");
	};
socket.onmessage = (event) => {
  try {
    const data = JSON.parse(event.data);
    const t = (data.temp + TemperatureOffset); // 温度にオフセットを適用し、1桁小数にフォーマット
    const temp = t.toFixed(1); // 温度にオフセットを適用し、1桁小数にフォーマット
    if ("time" in data && "temp" in data && "temp_prof" in data) {
      if (data.time > -1 && isRoasting) {
        addLiveDataPoint(roastChart, data.time, t); // グラフ追加関数
        document.getElementById('roast_time').textContent = formatSecondsToMinutesSeconds(data.time); 
        document.getElementById('roast_temperature').textContent = temp + "[℃]";
        if (roastChart.data.datasets[0].data.length === 0) {
            document.getElementById('profile_temperature').textContent = "--[℃]";
            document.getElementById('profile_ror').textContent = "--";
        }
        else {	
          document.getElementById('profile_temperature').textContent = data.temp_prof.toFixed(1) + "[℃]";
          if (roastChart.data.datasets[2].data.length > 0) {
            if (roastChart.data.datasets[2].data.length > data.time) {
              document.getElementById('profile_ror').textContent = (roastChart.data.datasets[2].data[data.time].y).toFixed(1);
            }
            else {
              document.getElementById('profile_ror').textContent = "--";
            }
          }
          document.getElementById('roast_ror').textContent = (roastChart.data.datasets[3].data[data.time].y).toFixed(1);
        }
      }
      else {	//焙煎中以外は現在温度のみ表示
        if (!isMinutesSecondsFormat) {
          document.getElementById('roast_time').textContent = "--[秒]";
        }
        else {
          document.getElementById('roast_time').textContent = "--:--"; 
        }
        document.getElementById('roast_temperature').textContent = temp + "[℃]";
        document.getElementById('profile_temperature').textContent = "--[℃]";
        document.getElementById('profile_ror').textContent = "--";
        document.getElementById('roast_ror').textContent = "--";        
      }
      
      if (isRoasting == true && data.time >= 1800 - 1) {
        sendStopCommand();
      }
  	}   
  	
	else if ("msg" in data) {
	  if (isRoasting) {
  		if (roastChart.data.datasets[0].data.length === 0) {
		    document.getElementById('roast_message').textContent = "焙煎中";
		  }
		  else {
        document.getElementById('roast_message').textContent = data.msg;
      }
	  }
	  else {
		  //document.getElementById('roast_message').textContent = "焙煎停止中";
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

let TemperatureOffset = 0;
function OffsetIncrement(offset){
  TemperatureOffset += offset;
}

function connectWebSocket() {
	socket = new WebSocket("ws://192.168.4.1:81/"); 
}

function generateUniqueId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}
function SetRoastingState(flag) {
  isRoasting = flag;
	  document.getElementById('stop-button').disabled = !flag;
	  document.getElementById('start-button').disabled = flag;
	  showRoastingIndicator(flag);
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

function configButtonCommand() {
  alert("設定画面はまだ実装されていません。");
  // ここに設定画面への遷移や処理を追加することができます
}

function helpButtonCommand() {
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

function sendStartCommand() {
  LiveData = [];
	sortTable();
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
        roastChart.destroy();
        initChart();
	      updateChartWithProfile(getProfileDataFromTable());
        SetRoastingState(true);
        HideChartIndicators();
        const img = document.getElementById('chart-point');   
        if (img && !img.classList.contains('pointer-animation')) {
          img.classList.add('pointer-animation');
        }
        resolve(response);
      } 
      else {
        alert("焙煎スタートに失敗しました。\nWiFi接続を確認してください。\nスタート失敗:" + response.message);
  		  SetRoastingState(false);
        reject(new Error("スタート失敗: " + response.message));
      }
    });
  });
}

function sendStopCommand() {
  const id = generateUniqueId(); // 一意なIDをつける
  const message = { command: "stop", id: id  };
  sendSafe(message);
  console.log("ストップコマンド送信");
  SetRoastingState(false);
  
   return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingResponses.delete(id);
      alert("焙煎ストップがタイムアウトしました。\nWiFi接続を確認してください。");
  		SetRoastingState(true);
      reject(new Error("タイムアウト"));
    }, 3000); // 3秒でタイムアウトする

    pendingResponses.set(id, (response) => {
      clearTimeout(timeout);
      if (response.status === "ok") {
	  	  document.getElementById('roast_message').textContent = "焙煎を停止しました";
        HideChartIndicators();
        const img = document.getElementById('chart-point');
        if (img && img.classList.contains('pointer-animation')) {
            img.classList.remove('pointer-animation');
        }
        resolve(response);
      } else {
        alert("焙煎ストップに失敗しました。\nWiFi接続、うずロースターの電源を確認してください。\nストップ失敗:" + response.message);
  		SetRoastingState(true);
        reject(new Error("ストップ失敗: " + response.message));
      }
    });
  });
 
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

function sendCurrentProfile() {
  showUploadOverlay();
  sortTable();
  const profileData = getProfileDataFromTable();
  updateChartWithProfile(profileData);

  if (!profileData || profileData.length === 0) {
    alert("焙煎プロファイルがありません。");
    hideUploadOverlay(); 
    return;
  }

 
  const converted = profileData.map(p => ({
    x: Math.round(p.time),
    y: Math.round(p.temp * 10) / 10
  }));

  sendProfileInBatches(converted)
    .then(() => {
      hideUploadOverlay(); // 成功
      roastChart.data.datasets[0].borderColor = active_profile_color
      roastChart.update();
    })
    .catch(err => {
      hideUploadOverlay(); 
		  alert("\nWiFi接続、うずロースターの電源を確認してください。\nアップロード失敗: " + err.message);
      roastChart.data.datasets[0].borderColor = profile_color;
      roastChart.update();
	});
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
      return totalSeconds + "[秒]"; // 秒表示
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
    AutoChartWidthAdjustment(chart, 0); // 最大値+1で表示範囲を調整
    chart.update(); // ← 'none' にするとアニメーションもカット
  }
}


function addRow(time = '', temp = '') {
  const table = document.getElementById('profileTable');
  const row = table.insertRow();
  const timeCell = row.insertCell(0);
  const tempCell = row.insertCell(1);
  const deleteCell = row.insertCell(2);

  timeCell.innerHTML = `<input type="number" value="${time}" step="1" min="0" max="1799" oninput="validateInput_time(this, 0, 1799)">`;
  tempCell.innerHTML = `<input type="number" value="${temp}" min="0" max="260" oninput="validateInput_temperature(this, 0, 260)">`;
  deleteCell.innerHTML = `<button onclick="this.parentNode.parentNode.remove()">🗑</button>`;
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
    statusIndicator.style.backgroundColor = '#00ff00';
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
      // 同じ時間が出てきたら、後に出てきた方で上書き
      latestEntries.set(time, temp);
    }
  });

  if (latestEntries.size === 0) {
    alert("テーブルに有効なプロファイルがありません。");
    return;
  }

  // 時間順にソートしてからJSON化
  const profile = Array.from(latestEntries.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([time, temp]) => ({ time, temp }));

  // タイトルとメモを取得
  const title = document.getElementById("profileTitle")?.value || "未設定";
  const memo = document.getElementById("profileMemo")?.value || "未設定";

  const data = {
    type: "roast_profile",
    title,
    memo,
    profile
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "roast_profile.json";
  a.click();
  URL.revokeObjectURL(url);

  document.getElementById('roast_message').textContent = "プロファイルを保存ドしました";
}

document.getElementById("fileInput").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
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

      event.target.value = ""; // 同じファイルでもイベント発火させるため
      sendCurrentProfile();

    } catch (err) {
      alert("プロファイル読み込みに失敗しました: " + err);
      hideUploadOverlay(); 
    }
  };

  reader.readAsText(file);
});


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

    const firstTime = originalProfileData[0].time;
    const lastTime = originalProfileData[originalProfileData.length - 1].time;

    const oneSecondIntervalData = [];

    // 開始時間から終了時間まで1秒刻みでループ
    for (let t = firstTime; t <= lastTime; t++) {
        // 各時間 t における温度を線形補間して取得
        // getInterpolatedProfileTemp は丸め処理を含んでいるものを使用
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
              tension: 0.01,
              order: 20, // リアルタイム温度より下に表示
              backgroundColor: gradient, 
              borderWidth: 1,
              pointRadius: 2, 
              pointHoverRadius: 8
          }, {
              label: '現在温度',
              data: [], // ここを最初から空配列に
              borderColor: 'rgba(255, 66, 99, 1)',
              fill: false,
              tension: 0.2,
              order: 1,
              backgroundColor: 'rgba(255, 66, 99, 0.8)',
              borderWidth: 3,
              pointRadius: 2,
              pointHoverRadius: 8
          }, {
              label: 'RoR (プロファイル温度）',
              data: [],
              borderSColor: 'rgba(159, 152, 255, 0.5)', 
              backgroundColor: 'rgba(157, 132, 255, 0.5)',
              fill: false,
              tension: 0.2,
              yAxisID: 'y1', // 別のY軸を使う
              order: 5, 
              borderWidth: 1,
              pointRadius: 1,
              pointHoverRadius: 8
          },{
              label: 'RoR (現在温度)',
              data: [],
              borderColor: 'rgba(194, 120, 29, 0.5)', 
              backgroundColor: 'rgba(255, 223, 61, 0.5)',
              fill: false,
              tension: 0.2,
              yAxisID: 'y1', // 別のY軸を使う
              order: 10, // 一番上に表示
              borderWidth: 1,
              pointRadius: 1,
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
                  title: { display: true, text: '経過時間 (秒)' },
                  min: 0,
                  max: 1800, // 30分
                  ticks: {
                    // ★★★ ここが重要！ ★★★
                    callback: function(value, index, values) {
                        // value は現在の目盛りの値（秒数）
                        // index は目盛りのインデックス
                        // values はすべての目盛りの配列
                        
                        // 秒数を分:秒形式に変換するヘルパー関数を使用
                        // 前の会話で定義した formatSecondsToMinutesSeconds 関数があればそれを使えます
                        // 例: function formatSecondsToMinutesSeconds(totalSeconds) { ... }
                        if (!isMinutesSecondsFormat) {
                            return value; // 秒表示
                        }
                        else {
                          return formatSecondsToMinutesSeconds(value);
                        }
                        const minutes = Math.floor(value / 60);
                        const seconds = Math.floor(value % 60);
                        const formattedSeconds = seconds < 10 ? '0' + seconds : seconds;
                        return `${minutes}:${formattedSeconds}`;
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

// ページ読み込み時に実行
window.addEventListener('DOMContentLoaded', () => {
  const roastTimeDisplay = document.getElementById('roast_time_area');
  if (roastTimeDisplay) {
    roastTimeDisplay.addEventListener('click', () => {
      isMinutesSecondsFormat = !isMinutesSecondsFormat;
      roastChart.update();
    });
  }
  initChart();
  document.getElementById('stop-button').disabled = true;
  roastChart.resize();
});

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
    if (!liveTempDataset || liveTempDataset.data.length === 0 || !profileDataset || profileDataset.data.length === 0) {
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

    const currentPx = { x: currentTime, y: currentTemp };
    let targetPx = ProfileSecondData[currentTime + Math.floor(Math.random() * (100)) + 1];
    if (!targetPx) {
      targetPx = { x: currentTime, y: currentTemp }; // データがない場合は現在の値を使用
    }
    
    if (currentPx && targetPx) {
      updateCorrectionVisuals(chart, currentPx, ProfileSecondData);

    } 
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
        // 要素やデータがない場合は何もしない
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
    if (!overlayCtx || !overlayCanvas || !chart || !currentTempData || !profileData || profileData.length === 0) {
        console.warn("Required data for updateCorrectionVisuals is missing or invalid.");
        return;
    }

    // 3. 焙煎プロファイル上の目標点を特定
    // ここでは「現在の時間から少し未来の目標プロファイルの点」を目指すアプローチを取ります
    // 例: 現在時間から +10秒後のプロファイル上の点を目標とする
    const targetLookAheadSeconds = 15; // 調整可能な秒数
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
    }

    if (!targetDataPoint) {
        console.warn("Could not find a valid target point on the profile.");
        return;
    }

    drawTargetDashLine(currentTempData, targetDataPoint, roastChart);
    // if (lastCurrentPoint != currentTempData) {
    //   lastCurrentPoint = currentTempData; // 現在の最新データ点
    //   animateDashLine(lastCurrentPoint, targetDataPoint, roastChart);
    // }
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

    overlayCanvas.width = roastChart.canvas.width;
    overlayCanvas.height = roastChart.canvas.height;
    const dpr = window.devicePixelRatio || 1;

    // 描画コンテキストを毎回リセットし、DPRスケールを適用する
    overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

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

        return {
            x: startPx.x + dx * t,
            y: startPx.y + dy * t
        };
    }

    const endPx = calculateLineEndPoint(currentPx, dx, dy, chartArea);

    if (animationStartTime == null) {
      animateDashLine(currentPx, endPx); 
    }
}

function drawDashLinePhysical(currentPx, endPx) {
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    // --- 破線を描画 ---
    overlayCtx.beginPath();
    overlayCtx.strokeStyle = 'rgba(0, 0, 0, 0.7)'; 
    overlayCtx.lineWidth = 2;
    overlayCtx.setLineDash([5, 5]);
    overlayCtx.moveTo(currentPx.x, currentPx.y);
    overlayCtx.lineTo(endPx.x, endPx.y); // 現在点から計算した端の点まで描画
    overlayCtx.stroke();
    overlayCtx.setLineDash([]); // 破線モードをリセット
}

let animationStartTime = null;
let last_endPx = null; 
// 現在の線の終点座標（アニメーションの開始点）を保持する変数
let currentLineEndPoint = null; // 例: { x: 100, y: 100 }
let AnimationIntervalID = null;
let DashLineAnimationStartData = null;
let DashLineAnimationEndData = null;
let DashLineStartDataPoint = null;

// アニメーションをトリガーする関数
/**
 * 補助線の描画をアニメーションさせる
 * @param {object} startDataPoint アニメーションの開始データ点 {x, y}
 * @param {object} endDataPoint アニメーションの最終データ点 {x, y} (目標プロファイル上の点)
 */
function animateDashLine(startDataPoint, endDataPoint) {
    // アニメーションの開始時刻を記録
    if (AnimationIntervalID == null) {
      AnimationIntervalID = setInterval(() => {
          animate100ms();
        }, 100);
    }
    animationStartTime = 0.1;
    DashLineStartDataPoint = startDataPoint; // 現在温度地点のデータ点
    drawDashLinePhysical(DashLineStartDataPoint, endDataPoint);

    // アニメーションの開始データ点と終了データ点を設定
    if (DashLineAnimationEndData === null) {
      DashLineAnimationStartData = endDataPoint;
    }
    else {
      DashLineAnimationStartData = DashLineAnimationEndData;
    }
    DashLineAnimationEndData = endDataPoint;             
}

// アニメーションループを開始
function animate100ms() {
    let progress = Math.min(animationStartTime, 1); // 0から1の進行度
    if (animationStartTime > 0.0) {
      animationStartTime += 0.1;
    }
    if (animationStartTime >= 1.0) {
      animationStartTime = null; // アニメーションをリセット
    }
    // 補間されたデータ値を計算
    const interpolatedDataX = DashLineAnimationStartData.x + (DashLineAnimationEndData.x - DashLineAnimationStartData.x) * progress;
    const interpolatedDataY = DashLineAnimationStartData.y + (DashLineAnimationEndData.y - DashLineAnimationStartData.y) * progress;

    drawDashLinePhysical(DashLineStartDataPoint, { x: interpolatedDataX, y: interpolatedDataY });
}


