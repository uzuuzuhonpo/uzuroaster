        const textarea = document.getElementById('profileMemo');
        const popup = document.getElementById('popupTextarea');
        const popupText = document.getElementById('popupText');
        const closeButton = document.getElementById('closePopup');
        const popupOverlay = document.getElementById('popupOverlay');

window.addEventListener('resize', () => {
  if (chart) {
    setTimeout(() => {
    	chart.resize();
    },50);
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
    isFullscreen = true;
	const targetDOMRect = chartCanvas.getBoundingClientRect();
	const targetTop = targetDOMRect.top + window.pageYOffset;
setTimeout(() => {
  window.scrollTo({ top: targetTop, behavior: 'smooth' });
}, 100); // 100msくらいが安定
  } else {
    document.getElementById('table_contents').style.display="block";
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
      addLiveDataPoint(roastChart, data.time, data.temp); // グラフ追加関数
	  document.getElementById('roast_time').textContent = data.time + "[秒]";
	  document.getElementById('roast_temperature').textContent = "現在温度" + data.temp + "[℃]";
	  document.getElementById('profile_temperature').textContent = "理想温度" + data.temp_prof + "[℃]";
	  
	  if (data.time >= 1800 - 1) {
		sendStopCommand();
	  }
  	}   
  	
	else if ("msg" in data) {
	  document.getElementById('roast_message').textContent = data.msg;
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
  	roastChart.destroy();
	initChart();
	sortTable();
	updateChartWithProfile(getProfileDataFromTable());
   const id = generateUniqueId(); // 一意なIDをつける
  const message = { command: "start", id: id  };
  sendSafe(message);
  console.log("スタートコマンド送信");
  SetRoastingState(true);

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
		})
    .catch(err => {
        hideUploadOverlay(); 
		alert("\nWiFi接続、うずロースターの電源を確認してください。\nアップロード失敗: " + err.message);
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

function addLiveDataPoint(chart, time, temp) {
  if (typeof time === 'number' && typeof temp === 'number') {
    const newPoint = { x: time, y: temp };
      console.log("data:", time, temp);

    // 直接 datasets[1].data に push（liveData 経由じゃなく）
    if (chart.data.datasets.length < 2) {
      chart.data.datasets.push({
        label: 'リアルタイム温度',
        data: [], // ここを最初から空配列に
        borderColor: 'rgba(255, 66, 99, 1)',
        fill: false,
        tension: 0.2,
        order: 10,
    backgroundColor: 'rgba(255, 66, 99, 0.8)',
    pointRadius: 3,       // 点の大きさ（デフォルトは3）
    pointHoverRadius: 4   // ホバー時の大きさ
      });
    }

	chart.options.plugins.verticalLinePlugin.xValue = time;	//縦軸 
    chart.data.datasets[1].data.push(newPoint);
    chart.update('none'); // ← 'none' にするとアニメーションもカット
  }
}


function addRow(time = '', temp = '') {
  const table = document.getElementById('profileTable');
  const row = table.insertRow();
  const timeCell = row.insertCell(0);
  const tempCell = row.insertCell(1);
  const deleteCell = row.insertCell(2);

  timeCell.innerHTML = `<input type="number" value="${time}" oninput="this.value = Math.max( 0, Math.min( this.value, 1799 ) )">`;
  tempCell.innerHTML = `<input type="number" value="${temp}" oninput="this.value = Math.max( 0, Math.min( this.value, 300 ) )">`;
  deleteCell.innerHTML = `<button onclick="this.parentNode.parentNode.remove()">🗑</button>`;
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
    else if (temp > 300) temp = 300;
    
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
    const row = table.insertRow();
    const timeCell = row.insertCell(0);
    const tempCell = row.insertCell(1);
    const deleteCell = row.insertCell(2);

    timeCell.innerHTML = `<input type="number" value="${time}" />`;
    tempCell.innerHTML = `<input type="number" value="${temp}" />`;
    const deleteBtn = createDeleteButton();
	deleteCell.appendChild(deleteBtn);
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
}

document.getElementById("fileInput").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const json = JSON.parse(e.target.result);
      if (!Array.isArray(json.profile)) throw "Invalid format";

         // タイトルとメモを反映
          document.getElementById("profileTitle").value = json.title || "";
          document.getElementById("profileMemo").value = json.memo || "";

      // テーブル初期化
      const table = document.getElementById('profileTable');
      while (table.rows.length > 1) table.deleteRow(1);

      json.profile.forEach(entry => {
        addRow(entry.time, entry.temp);
      });
      
        sortTable();
	 	updateChartWithProfile(getProfileDataFromTable());
	 	  event.target.value = "";	// 同じファイルを選んでもイベント発火するように
	 	  sendCurrentProfile();

    } catch (err) {
      alert("JSONの読み込みに失敗しました: " + err);
    }
  };
  reader.readAsText(file);
});


let chart; // グローバルで持つ

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

let roastChart = null;

function updateChartWithProfile(profileData) {
  if (!roastChart) return;

  const times = profileData.map(p => p.time);
  const temps = profileData.map(p => p.temp);

  roastChart.data.labels = times;
  roastChart.data.datasets[0].data = temps;
  roastChart.update();
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
    ctx.strokeStyle = options.color || 'red';
    ctx.stroke();
    ctx.restore();
  }
};


function initChart() {
  const ctx = document.getElementById('roastChart').getContext('2d');

// グラデーション作成（縦方向）
const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
gradient.addColorStop(0, 'rgba(100, 100, 100, 0.5)');
gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

roastChart = new Chart(ctx, {
  type: 'line',
  data: {
    labels: [],
    datasets: [{
      label: '焙煎プロファイル',
      data: [],
      borderColor: 'rgba(100,100,100,0.5)',
      backgroundColor: gradient, 
      borderWidth: 1,
      tension: 0.01,
      fill: true,
      order: 1,
      pointRadius: 2,
      pointHoverRadius: 4
    }]
  },
  options: {
    plugins: {
      verticalLinePlugin: {
        xValue: 0,	 // ←ここに現在の時間
        color: 'rgba(0,0,100,0.3)'
      }
    },
    responsive: true,
    scales: {
      x: {
        type: 'linear',
        title: { display: true, text: '時間（秒）' },
        min: 0,
        max: 1800
      },
      y: {
        title: { display: true, text: '温度（℃）' },
        min: 0,
        max: 300
      }
    }
  },
  plugins: [verticalLinePlugin]
});

}

// ページ読み込み時に実行
window.addEventListener('DOMContentLoaded', () => {
  initChart();
  document.getElementById('stop-button').disabled = true;

});



