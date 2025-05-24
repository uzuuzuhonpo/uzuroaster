const textarea = document.getElementById('profileMemo');
const popup = document.getElementById('popupTextarea');
const popupText = document.getElementById('popupText');
const closeButton = document.getElementById('closePopup');
const popupOverlay = document.getElementById('popupOverlay');

let roastChart = null;
const profile_color = 'rgba(80,80,80,0.4)'; // プロファイルの色 
const active_profile_color = 'rgba(136, 184, 221, 0.8)'; // アクティブプロファイルの色  

window.addEventListener('resize', () => {
  if (roastChart) {
    roastChart.resize();
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
    if ("time" in data && "temp" in data && "temp_prof" in data) {
      if (data.time > -1 && isRoasting) {
        addLiveDataPoint(roastChart, data.time, data.temp); // グラフ追加関数
        document.getElementById('roast_time').textContent = data.time + "[秒]";
        document.getElementById('roast_temperature').textContent = data.temp.toFixed(1) + "[℃]";
      if (roastChart.data.datasets[0].data.length === 0) {
        document.getElementById('profile_temperature').textContent = "--[℃]";
        }
      else {	
        document.getElementById('profile_temperature').textContent = data.temp_prof.toFixed(1) + "[℃]";
      }
	  }
	  else {	//焙煎中以外は現在温度のみ表示
		  document.getElementById('roast_time').textContent = "--[秒]";
		  document.getElementById('roast_temperature').textContent = data.temp.toFixed(1) + "[℃]";
		  document.getElementById('profile_temperature').textContent = "--[℃]";
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
  }
};

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
    // エラー処理（UIに通知とか、ログに出すとか）入れてもOK
  }
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
        resolve(response);
      } else {
        alert("焙煎ストップに失敗しました。\nWiFi接続、うずロースターの電源を確認してください。\nストップ失敗:" + response.message);
  		SetRoastingState(true);
        reject(new Error("ストップ失敗: " + response.message));
      }
    });
  });
 
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
  sortTable();
  const profileData = getProfileDataFromTable();

  if (!profileData || profileData.length === 0) {
    alert("焙煎プロファイルがありません。");
    return;
  }

  showUploadOverlay();
 
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
  
  // テーブルを時間順にソート
  sortTable();
  
  // チャートを更新
  updateChartWithProfile(getProfileDataFromTable());
  
  console.log("直前の焙煎データでテーブルを上書きしました", realTimeData.length + "ポイント");
  sendCurrentProfile();
}

function showUploadOverlay() {
  document.getElementById("uploadOverlay").style.display = "flex";
}

function hideUploadOverlay() {
  document.getElementById("uploadOverlay").style.display = "none";
}

let LiveData = [];
function addLiveDataPoint(chart, time, temp) {
  if (typeof time === 'number' && typeof temp === 'number') {
    const newPoint = { x: time, y: temp };
    console.log("data:", time, temp);
    LiveData.push(newPoint);

    chart.options.plugins.verticalLinePlugin.xValue = time;	//縦軸
    let lastPoint = { x: 0, y: 0 };
    if (LiveData.length > 1) {
      lastPoint = LiveData[LiveData.length - 1];
    }
    else {
      lastPoint = newPoint;
    }
    chart.data.datasets[1].data.push(newPoint);
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

  timeCell.innerHTML = `<input type="number" value="${time}" min="0" max="1799" oninput="validateInput(this, 0, 1799)">`;
  tempCell.innerHTML = `<input type="number" value="${temp}" min="0" max="260" oninput="validateInput(this, 0, 260)">`;
  deleteCell.innerHTML = `<button onclick="this.parentNode.parentNode.remove()">🗑</button>`;
}

function validateInput(input, min, max) {
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
      } else {
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

      sortTable();
      updateChartWithProfile(getProfileDataFromTable());
      event.target.value = ""; // 同じファイルでもイベント発火させるため
      sendCurrentProfile();

    } catch (err) {
      alert("プロファイル読み込みに失敗しました: " + err);
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
        const temp = parseInt(cells[1].querySelector('input')?.value);

        // 空白・NaNは無視
        if (isNaN(time) || isNaN(temp)) continue;

        profile.push({ time, temp });
    }

    return profile;
}

function updateChartWithProfile(profileData) {
  if (!roastChart) return;

  const times = profileData.map(p => p.time);
  const temps = profileData.map(p => p.temp);

  roastChart.data.labels = times;
  roastChart.data.datasets[0].data = temps;
  AutoChartWidthAdjustment(roastChart, 0); // 最大値+1で表示範囲を調整
  roastChart.update();
}

function AutoChartWidthAdjustment(chart, minTime, maxTime = 1800) {
  let x = 0;
  let x1 = 0;
  let profile = getProfileDataFromTable();
  if (profile.length > 0) {
    x = profile[profile.length - 1].time;
  } 
  if (chart.data.datasets[1] && chart.data.datasets[1].data.length > 0) { 
    x1 = chart.data.datasets[1].data[chart.data.datasets[1].data.length - 1].x;
  }
  //const total = Math.min(Math.floor(((x + x1) / 300)) * 300 + 300, 1800);
  const total = Math.min(x + x1 + 200, 1800);

  chart.options.scales.x.min = minTime;
  chart.options.scales.x.max = total;
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
  // --- Chart.js初期化部分 (抜粋) ---
  roastChart = new Chart(ctx, {
      type: 'line',
      data: {
          labels: [], // profileDataは既存のHTMLから取得する必要がある
          datasets: [{
              label: '焙煎プロファイル温度',
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
              label: 'リアルタイム温度',
              data: [], // ここを最初から空配列に
              borderColor: 'rgba(255, 66, 99, 1)',
              fill: false,
              tension: 0.2,
              order: 10,
              backgroundColor: 'rgba(255, 66, 99, 0.8)',
              pointRadius: 3,
              pointHoverRadius: 8
          }, {
              // **RoR (Rate of Rise) データセットを追加**
              label: 'RoR (Rate of Rise)',
              data: [],
              borderColor: 'rgba(255, 159, 64, 1)', // RoR用の色
              backgroundColor: 'rgba(255, 159, 64, 0.5)',
              fill: false,
              tension: 0.2,
              yAxisID: 'y1', // 別のY軸を使う
              order: 5, // 一番上に表示
              pointRadius: 3,
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
                  max: 1800 // 30分
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
                  min: 0,
                  max: 30 // RoRの適切な最大値を設定
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
  // --- Chart.js初期化部分 終了 ---
}

// ページ読み込み時に実行
window.addEventListener('DOMContentLoaded', () => {
  initChart();
  document.getElementById('stop-button').disabled = true;
  roastChart.resize();
});

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
        const rorDataset = chart.data.datasets[2]; // RoRデータセット

        if (!liveTempDataset || liveTempDataset.data.length === 0 || !profileDataset || profileDataset.data.length === 0) {
            return;
        }

        // const heatmapCanvas = document.getElementById("heatmap");
        // heatmapCanvas.width = chart.width;
        // heatmapCanvas.height = chart.height;

        const heatmapCtx = ctx; //heatmapCanvas.getContext('2d');
        //heatmapCtx.clearRect(0, 0, chart.width, chart.height); //heatmapCanvas.width, heatmapCtx.height);

        heatmapCtx.save();
        heatmapCtx.translate(chartArea.left, chartArea.top);

        const latestLivePoint = liveTempDataset.data[liveTempDataset.data.length - 1];
        const currentTime = latestLivePoint.x;
        const currentTemp = latestLivePoint.y;

        const targetTemp = getInterpolatedProfileTemp(getProfileDataFromTable(), currentTime);
        const targetRoR = getInterpolatedProfileRoR(getProfileDataFromTable(), currentTime); // 目標RoRを取得
        const currentRoR = calculateCurrentRoR(liveTempDataset.data, 30); // 現在のRoRを取得
        const acceleration = calculateAcceleration(liveTempDataset.data, 30, 60); // 加速度を取得

        // if (targetTemp === null || targetRoR === null) {
        //     heatmapCtx.restore();
        //     return;
        // }

        const tempDifference = currentTemp - targetTemp;
        const indicatorColor = getColorForTemperatureDifference(tempDifference); // ここで透明度を調整しない
        const indicatorRadius = getRadiusForTemperatureDifference(tempDifference);

        const pixelX = scales.x.getPixelForValue(currentTime) - chartArea.left;
        const pixelY = scales.y.getPixelForValue(currentTemp) - chartArea.top;

        // 1. ヒートマップ円の描画
        ctx.beginPath();
        ctx.arc(pixelX, pixelY, indicatorRadius, 0, Math.PI * 2);
        ctx.fillStyle = indicatorColor;
        ctx.fill();
        const strokeRadius = indicatorRadius;//indicatorRadius + radi / 2;
        ctx.arc(pixelX, pixelY, strokeRadius, 0, Math.PI * 2);
        ctx.strokeStyle = setHslaAlpha(indicatorColor, 0.2);
        ctx.lineWidth = indicatorRadius * 1.05;
        ctx.stroke();

        // 2. 将来の矢印描画のためにtranslateを戻す（この時点では矢印は描かない）
        // ctx.translate(-pixelX, -pixelY); // 矢印の原点移動を戻す

        ctx.restore(); // 保存した描画状態を元に戻す（重要！）



        // --- 矢印の描画 ---
        const { length: arrowLength, angle: arrowAngle } = calculateArrowVector(
            currentTemp, targetTemp, currentRoR, targetRoR, acceleration
        );

        heatmapCtx.beginPath();
        // 矢印の開始点を円の中心、または円の端から少し離す（調整可能）
        const arrowStartOffset = indicatorRadius + 5; // 円の外側から少し離す
        
        // 矢印の始点 (円の中心からの相対位置)
        // 角度0度が右なので、cos(angle) がX、sin(angle) がY
        const startX = pixelX + Math.cos(arrowAngle) * arrowStartOffset;
        const startY = pixelY + Math.sin(arrowAngle) * arrowStartOffset;

        // 矢印の終点
        const endX = pixelX + Math.cos(arrowAngle) * (arrowStartOffset + arrowLength);
        const endY = pixelY + Math.sin(arrowAngle) * (arrowStartOffset + arrowLength);

        heatmapCtx.moveTo(startX, startY);
        heatmapCtx.lineTo(endX, endY);

        // 矢印の羽根（ヘッド）
        const headLength = 10; // 羽根の長さ
        const headAngle = Math.PI / 6; // 羽根の開き角度 (30度)

        // 終点から羽根の始点を計算
        heatmapCtx.lineTo(
            endX - headLength * Math.cos(arrowAngle - headAngle),
            endY - headLength * Math.sin(arrowAngle - headAngle)
        );
        heatmapCtx.moveTo(endX, endY); // もう一度終点に戻る
        heatmapCtx.lineTo(
            endX - headLength * Math.cos(arrowAngle + headAngle),
            endY - headLength * Math.sin(arrowAngle + headAngle)
        );

        heatmapCtx.strokeStyle = 'rgba(0, 0, 0, 0.8)'; // 矢印の色 (黒、少し透明)
        heatmapCtx.lineWidth = 2; // 矢印の線幅
        heatmapCtx.stroke();
        // --- 矢印の描画 終了 ---

        heatmapCtx.restore();
    }
};

// SmartAIIndicator プラグイン
const smartAIIndicatorPlugin2 = {
    id: 'smartAIIndicator',
    // グラフの描画後に実行されるフック
    afterDraw(chart, args, options) {
        const { ctx, chartArea, scales } = chart;
        const profileDataset = chart.data.datasets[0]; // 設定温度プロファイル (roastData)
        const liveTempDataset = chart.data.datasets[1]; // リアルタイム温度

        // リアルタイムデータが存在しない、またはデータポイントが少なすぎる場合は何もしない
        if (!liveTempDataset || liveTempDataset.data.length === 0 || !profileDataset || profileDataset.data.length === 0) {
            return;
        }

        // 最新のリアルタイムデータポイントを取得
        const latestLivePoint = liveTempDataset.data[liveTempDataset.data.length - 1];
        const currentTime = latestLivePoint.x;
        const currentTemp = latestLivePoint.y;

        // 現在時間に対応する設定温度を補間して取得
        const targetTemp = getInterpolatedProfileTemp(getProfileDataFromTable(), currentTime);

        // targetTempがnullの場合も描画しない
        if (targetTemp === null) {
            return;
        }

        // 温度差を計算
        const tempDifference = currentTemp - targetTemp; // 正なら設定より高い、負なら低い

        // 円の色と半径を計算
        const indicatorColor = getColorForTemperatureDifference(tempDifference);
        const indicatorRadius = getRadiusForTemperatureDifference(tempDifference);

        // --- 描画開始 ---
        ctx.save(); // 現在の描画状態を保存

        // Chart.jsの描画エリアの左上隅にCanvasの原点を移動
        ctx.translate(chartArea.left, chartArea.top);

        // 現在のデータポイントのピクセル座標（ChartArea内での相対座標）
        const pixelX = scales.x.getPixelForValue(currentTime) - chartArea.left;
        const pixelY = scales.y.getPixelForValue(currentTemp) - chartArea.top;

        // 1. ヒートマップ円の描画
        ctx.beginPath();
        ctx.arc(pixelX, pixelY, indicatorRadius, 0, Math.PI * 2);
        ctx.fillStyle = indicatorColor;
        ctx.fill();
        const strokeRadius = indicatorRadius;//indicatorRadius + radi / 2;
        ctx.arc(pixelX, pixelY, strokeRadius, 0, Math.PI * 2);
        ctx.strokeStyle = setHslaAlpha(indicatorColor, 0.2);
        ctx.lineWidth = indicatorRadius * 1.05;
        ctx.stroke();

        // 2. 将来の矢印描画のためにtranslateを戻す（この時点では矢印は描かない）
        // ctx.translate(-pixelX, -pixelY); // 矢印の原点移動を戻す

        ctx.restore(); // 保存した描画状態を元に戻す（重要！）
    }
};

// SmartAIIndicator プラグインをChart.jsに登録
Chart.register(smartAIIndicatorPlugin);


// --- ヘルパー関数 ---
/**
 * プロファイルデータから指定された時間における温度を線形補間して取得します。
 * @param {Array<Object>} profileData - { x: time, y: temp } 形式のプロファイルデータ配列。
 * @param {number} currentTime - 補間したい時間。
 * @returns {number|null} 補間された温度、またはデータ不足の場合はnull。
 */
function getInterpolatedProfileTemp(profileData, currentTime) {
    if (profileData.length === 0) return null;

    // 現在時間がプロファイル開始前なら最初の温度
    if (currentTime <= profileData[0].time) {
        return profileData[0].temp;
    }
    // 現在時間がプロファイル終了後なら最後の温度
    if (currentTime >= profileData[profileData.length - 1].time) {
        return profileData[profileData.length - 1].temp;
    }

    // 線形補間
    for (let i = 0; i < profileData.length - 1; i++) {
        const p1 = profileData[i];
        const p2 = profileData[i + 1];
        if (currentTime >= p1.time && currentTime <= p2.time) {
            const ratio = (currentTime - p1.time) / (p2.time - p1.time);
            return p1.temp + (p2.temp - p1.temp) * ratio;
        }
    }
    return null; // 予期せぬエラー
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
 * プロファイルデータから指定された時間における目標RoRを線形補間して取得します。
 * これはプロファイル曲線のその点での傾きに相当します。
 * @param {Array<Object>} profileData - { x: time, y: temp } 形式のプロファイルデータ配列。
 * @param {number} currentTime - 補間したい時間。
 * @returns {number|null} 補間されたRoR (°C/min)、またはデータ不足の場合はnull。
 */
function getInterpolatedProfileRoR(profileData, currentTime) {
    if (profileData.length < 2) return null;

    // 現在時間がプロファイル開始前なら最初のRoR (または0)
    if (currentTime <= profileData[0].x) {
        // 最初の2点間のRoRを返すか、初期RoRとして定義された値を返す
        const p1 = profileData[0];
        const p2 = profileData[1];
        const dt = p2.x - p1.x;
        const dT = p2.y - p1.y;
        return dt > 0 ? (dT / dt) * 60 : 0;
    }
    // 現在時間がプロファイル終了後なら最後のRoR
    if (currentTime >= profileData[profileData.length - 1].x) {
        const p1 = profileData[profileData.length - 2];
        const p2 = profileData[profileData.length - 1];
        const dt = p2.x - p1.x;
        const dT = p2.y - p1.y;
        return dt > 0 ? (dT / dt) * 60 : 0;
    }

    // 線形補間して、その点での傾きを計算
    for (let i = 0; i < profileData.length - 1; i++) {
        const p1 = profileData[i];
        const p2 = profileData[i + 1];
        if (currentTime >= p1.x && currentTime <= p2.x) {
            // 現在の時間がこの区間にある場合、この区間の傾きが目標RoR
            const dt = p2.x - p1.x;
            const dT = p2.y - p1.y;
            return dt > 0 ? (dT / dt) * 60 : 0; // °C/min に変換
        }
    }
    return null;
}

/**
 * リアルタイム温度データから現在のRoRを計算します。
 * (例: 直近30秒間の平均RoR)
 * @param {Array<Object>} liveData - { x: time, y: temp } 形式のリアルタイム温度データ。
 * @param {number} periodSeconds - RoR計算に使う期間（秒）。
 * @returns {number} 現在のRoR (°C/min)。データ不足の場合は0。
 */
function calculateCurrentRoR(liveData, periodSeconds = 30) {
    if (liveData.length < 2) return 0;

    const currentPoint = liveData[liveData.length - 1];
    let pastPoint = null;

    // periodSeconds 前のデータポイントを探す
    for (let i = liveData.length - 2; i >= 0; i--) {
        if (currentPoint.x - liveData[i].x >= periodSeconds) {
            pastPoint = liveData[i];
            break;
        }
    }

    if (!pastPoint) { // 十分な過去データがない場合は、利用可能な最新2点を使う
        pastPoint = liveData[0];
    }

    const timeElapsed = currentPoint.x - pastPoint.x;
    const tempChange = currentPoint.y - pastPoint.y;

    return timeElapsed > 0 ? (tempChange / timeElapsed) * 60 : 0; // °C/min
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
    const currentRoR = calculateCurrentRoR(liveData, rorPeriodSeconds);

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

    const prevRoR = calculateCurrentRoR(pastRoRData, rorPeriodSeconds);

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