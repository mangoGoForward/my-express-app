const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

// 1. 启动时记录信息
const T0 = Date.now();
const localTime = new Date(T0).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false
});
let MAC = '';

function getHostMAC() {
    if (process.env.INTERFACE) {
        return readMAC(process.env.INTERFACE)
    }
    const netPath = '/sys/class/net';
    const interfaces = fs.readdirSync(netPath);

    // 网卡筛选规则
    const PHYSICAL_DEVICE_REGEX = /^(en|eth|wl)/;
    const VIRTUAL_INTERFACE_REGEX = /^(lo|docker|veth|br-|virbr)/;

    // 候选网卡列表
    const candidates = interfaces.filter(iface => {
        // 排除虚拟接口
        if (VIRTUAL_INTERFACE_REGEX.test(iface)) return false;
        
        // 验证是否为物理设备
        const devicePath = path.join(netPath, iface, 'device');
        try {
            return fs.existsSync(devicePath) && 
                   PHYSICAL_DEVICE_REGEX.test(iface);
        } catch (e) {
            return false;
        }
    });

    // 优先级排序
    const priorityOrder = ['eth0', 'enp0s1', 'enp3s0'];
    const sorted = candidates.sort((a, b) => 
        priorityOrder.indexOf(b) - priorityOrder.indexOf(a)
    );

    // 获取默认路由网卡
    try {
        const routeContent = fs.readFileSync('/proc/net/route', 'utf8');
        const defaultRoute = routeContent.split('\n')
            .find(line => line.startsWith('Iface\t') && line.includes('00000000'));
        if (defaultRoute) {
            const defaultIface = defaultRoute.split('\t')[0];
            if (sorted.includes(defaultIface)) return readMAC(defaultIface);
        }
    } catch (e) {}

    // 读取第一个有效网卡
    for (const iface of sorted) {
        try {
            return readMAC(iface);
        } catch (e) {
            continue;
        }
    }

    throw new Error('No physical network interface found');
}

function readMAC(iface) {
    const addrFile = path.join('/sys/class/net', iface, 'address');
    return fs.readFileSync(addrFile, 'utf8').trim().toUpperCase();
}

try {
    // 尝试从宿主机网络接口读取MAC地址（需要特权模式）
    MAC = getHostMAC();
} catch (e) {
    // 从环境变量获取（Kubernetes场景）
    MAC = process.env.HOST_MAC || '00:00:00:00:00:00';
}

// 2. HTTP接口
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 信息接口
app.get('/GetMac', (req, res) => {
    res.set('Content-Type', 'text/plain');
    res.send(`启动时间: ${localTime}\nMAC: ${MAC}`);
});

// 3. 可视化界面
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>时间触发器</title>
            <style>
                .container { max-width: 600px; margin: 2rem auto; padding: 20px; }
                input[type="datetime-local"] { width: 220px; padding: 8px; }
                .timezone-info { color: #666; margin: 10px 0; }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>系统信息</h2>
                <div id="info">
                    <p>启动时间: <span id="startTime">${localTime}</span></p>
                    <p>宿主机MAC: <span id="macAddress">${MAC}</span></p>
                </div>
            </div>
            <div class="container">
                <h2>设置触发时间（精确到秒）</h2>
                <form id="timeForm">
                    <input 
                        type="datetime-local" 
                        id="timeInput"
                        step="1" 
                        required
                    >
                    <button type="button" onclick="submitTime()">提交</button>
                </form>
                <div id="result"></div>
            </div>

            <script>
                function submitTime() {
                    const input = document.getElementById('timeInput');
                    const datetime = input.value;  // 格式：YYYY-MM-DDTHH:mm:ss
                    
                    // 转换为UTC时间戳（秒级）
                    const localDate = new Date(datetime);
                    const utcTimestamp = Math.floor(localDate.getTime() / 1000);

                    // 提交到后端
                    fetch('/trigger', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ timestamp: utcTimestamp })
                    })
                    .then(response => response.json());
                }
            </script>
        </body>
        </html>
    `);
});

// 4. 时间检测端点
app.post('/trigger', (req, res) => {
    // 获取秒级时间戳
    const receivedTimestamp = parseInt(req.body.timestamp);
    const currentUTCSeconds = Math.floor(Date.now() / 1000);

    // 时间验证
    if (isNaN(receivedTimestamp) || receivedTimestamp <= currentUTCSeconds) {
        return res.status(400).json({
            error: 'Invalid timestamp',
            current_utc: currentUTCSeconds,
            server_time: new Date().toISOString()
        });
    }

    // 记录UTC时间日志
    console.log(`[${new Date().toISOString()}] 设置触发时间：`, {
        received_timestamp: receivedTimestamp,
        utc_time: new Date(receivedTimestamp * 1000).toISOString()
    });

    // 启动检测逻辑
    scheduleUTCCheck(receivedTimestamp);
});

function scheduleUTCCheck(targetSeconds) {
    const currentUTC = Math.floor(Date.now() / 1000);
    const timeDiff = targetSeconds - currentUTC;

    // 动态调度策略
    if (timeDiff > 600) { // 10分钟以上
        setTimeout(() => {
            startPrecisionCheck(targetSeconds);
        }, (timeDiff - 300) * 1000); // 提前5分钟启动精准检测
    } else if (timeDiff > 5) { // 5秒以上
        setTimeout(() => {
            startPrecisionCheck(targetSeconds);
        }, (timeDiff - 2) * 1000); // 提前2秒
    } else {
        startPrecisionCheck(targetSeconds);
    }
}

function startPrecisionCheck(targetSeconds) {
    const checkInterval = setInterval(() => {
        const currentUTC = Math.floor(Date.now() / 1000);
        
        if (currentUTC === targetSeconds) {
            console.log(`[${new Date().toISOString()}] UTC时间匹配，触发重启`);
            process.exit(1);
        }

        // 超时保护（+2秒窗口）
        if (currentUTC > targetSeconds + 2) {
            clearInterval(checkInterval);
        }
    }, 100); // 100ms检测间隔
}

// 启动服务
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`服务已启动，端口：${PORT}`);
    console.log(`启动时间：${localTime}`);
    console.log(`宿主机MAC：${MAC}`);
});