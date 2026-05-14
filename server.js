const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let tiktokConnection = null;
let currentUniqueId = null;
let reconnectTimer = null;
let isConnected = false;
let isConnecting = false;

function connectToTikTok(uniqueId) {
    if (!uniqueId) return;

    if (isConnecting) return;

    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    if (tiktokConnection) {
        try {
            tiktokConnection.removeAllListeners();
            tiktokConnection.disconnect();
        } catch (e) {}
        tiktokConnection = null;
    }

    isConnected = false;
    isConnecting = true;
    currentUniqueId = uniqueId;

    console.log(`🚀 Đang kết nối tới TikTok ID: ${uniqueId}`);
    io.emit('log', `Đang kết nối tới @${uniqueId}...`);

    // Khởi tạo kết nối với cấu hình tối ưu cho v2.x
    tiktokConnection = new WebcastPushConnection(uniqueId, {
        enableExtendedGiftInfo: true,
        requestPollingIntervalMs: 2000,
        clientParams: {
            "app_language": "vi-VN",
            "device_platform": "web"
        }
    });

    tiktokConnection.connect().then(state => {
        console.log(`✅ Kết nối thành công! Room ID: ${state.roomId}`);
        isConnected = true;
        isConnecting = false;
        io.emit('connected', { roomId: state.roomId, uniqueId });
        io.emit('log', `✅ Đã kết nối thành công tới @${uniqueId}`);
    }).catch(err => {
        console.error('❌ Lỗi kết nối:', err.message);
        isConnected = false;
        isConnecting = false;
        
        let msg = err.message;
        if (msg.includes("initial room data")) msg = "Không tìm thấy phòng Live. Hãy chắc chắn bạn đang livestream!";
        if (msg.includes("Rate Limited")) msg = "Bạn đang bị TikTok chặn tạm thời (Rate Limited). Hãy đợi vài phút rồi thử lại.";
        
        io.emit('log', `❌ ${msg}`);
        
        // Tự động thử lại sau 15 giây
        reconnectTimer = setTimeout(() => connectToTikTok(uniqueId), 15000);
    });

    // Lắng nghe sự kiện
    tiktokConnection.on('chat', data => io.emit('tiktok-chat', data));
    tiktokConnection.on('gift', data => io.emit('tiktok-gift', data));
    tiktokConnection.on('like', data => io.emit('tiktok-like', data));
    tiktokConnection.on('follow', data => io.emit('tiktok-follow', data));
    tiktokConnection.on('share', data => io.emit('tiktok-share', data));

    tiktokConnection.on('disconnected', () => {
        if (!isConnected && !isConnecting) return;
        isConnected = false;
        isConnecting = false;
        io.emit('log', '⚠️ Mất kết nối. Đang kết nối lại...');
        reconnectTimer = setTimeout(() => connectToTikTok(uniqueId), 10000);
    });
}

io.on('connection', (socket) => {
    console.log('Client connected');

    socket.on('setUniqueId', (data) => {
        // Chấp nhận cả string hoặc object
        let uniqueId = typeof data === 'string' ? data : data.uniqueId;
        
        if (uniqueId) {
            // Làm sạch ID: xóa @, xóa khoảng trắng
            uniqueId = uniqueId.replace('@', '').trim();
            connectToTikTok(uniqueId);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Server đang chạy tại http://localhost:${PORT}`);
});
