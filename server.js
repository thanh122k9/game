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
let currentSessionId = null;
let reconnectTimer = null;
let isConnected = false;
let isConnecting = false;

function connectToTikTok(uniqueId, sessionId) {
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
    currentSessionId = sessionId;

    console.log(`🚀 Đang kết nối tới @${uniqueId}...`);
    io.emit('log', `Đang kết nối tới @${uniqueId}...`);

    // Cấu hình kết nối
    const options = {
        enableExtendedGiftInfo: true
    };

    if (sessionId) {
        options.sessionId = sessionId;
        console.log("🔑 Đang dùng Session ID để vượt rào...");
    }

    tiktokConnection = new WebcastPushConnection(uniqueId, options);

    tiktokConnection.connect().then(state => {
        console.log(`✅ Thành công! Room ID: ${state.roomId}`);
        isConnected = true;
        isConnecting = false;
        io.emit('connected', { roomId: state.roomId, uniqueId });
        io.emit('log', `✅ Kết nối thành công!`);
    }).catch(err => {
        console.error('❌ Lỗi:', err.message);
        isConnected = false;
        isConnecting = false;
        
        let errorMsg = err.message;
        if (errorMsg.includes("initial room data")) {
            errorMsg = "Không tìm thấy phòng live. Hãy chắc chắn bạn đang Live và thử nhập Session ID (trong phần Nâng cao).";
        }
        
        io.emit('log', `❌ ${errorMsg}`);
        reconnectTimer = setTimeout(() => connectToTikTok(uniqueId, sessionId), 15000);
    });

    tiktokConnection.on('chat',   data => io.emit('tiktok-chat', data));
    tiktokConnection.on('gift',   data => io.emit('tiktok-gift', data));
    tiktokConnection.on('like',   data => io.emit('tiktok-like', data));
    tiktokConnection.on('follow', data => io.emit('tiktok-follow', data));
    tiktokConnection.on('share',  data => io.emit('tiktok-share', data));

    tiktokConnection.on('disconnected', () => {
        if (!isConnected && !isConnecting) return;
        isConnected = false;
        isConnecting = false;
        io.emit('log', '⚠️ Mất kết nối. Đang thử lại...');
        reconnectTimer = setTimeout(() => connectToTikTok(uniqueId, sessionId), 10000);
    });
}

io.on('connection', (socket) => {
    socket.on('setUniqueId', (data) => {
        const uniqueId = typeof data === 'string' ? data : data.uniqueId;
        const sessionId = typeof data === 'object' ? data.sessionId : null;
        
        // Xóa dấu @ nếu người dùng nhập thừa
        const cleanId = uniqueId.replace('@', '');
        connectToTikTok(cleanId, sessionId);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Server chạy tại http://localhost:${PORT}`);
});
