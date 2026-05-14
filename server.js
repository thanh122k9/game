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

    if (isConnecting) {
        console.log('Đang kết nối, vui lòng chờ...');
        return;
    }

    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    // Dọn dẹp kết nối cũ
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

    console.log(`🚀 Đang kết nối tới @${uniqueId}...`);
    io.emit('log', `Đang kết nối tới @${uniqueId}...`);

    tiktokConnection = new WebcastPushConnection(uniqueId);

    tiktokConnection.connect().then(state => {
        console.log(`✅ Kết nối thành công! Room: ${state.roomId}`);
        isConnected = true;
        isConnecting = false;
        io.emit('connected', { roomId: state.roomId, uniqueId });
        io.emit('log', `✅ Kết nối thành công tới phòng ${state.roomId}`);
    }).catch(err => {
        console.error('❌ Kết nối thất bại:', err.message);
        isConnected = false;
        isConnecting = false;
        io.emit('log', `❌ Thất bại: ${err.message}. Thử lại sau 15 giây...`);
        reconnectTimer = setTimeout(() => connectToTikTok(uniqueId), 15000);
    });

    tiktokConnection.on('chat',   data => io.emit('tiktok-chat', data));
    tiktokConnection.on('gift',   data => io.emit('tiktok-gift', data));
    tiktokConnection.on('like',   data => io.emit('tiktok-like', data));
    tiktokConnection.on('follow', data => io.emit('tiktok-follow', data));
    tiktokConnection.on('share',  data => io.emit('tiktok-share', data));

    tiktokConnection.on('disconnected', () => {
        if (!isConnected && !isConnecting) return;
        console.log('⚠️ Mất kết nối, thử lại sau 10 giây...');
        isConnected = false;
        isConnecting = false;
        io.emit('log', '⚠️ Mất kết nối. Thử lại sau 10 giây...');
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => connectToTikTok(uniqueId), 10000);
    });

    tiktokConnection.on('streamEnd', () => {
        console.log('📴 Stream kết thúc.');
        isConnected = false;
        isConnecting = false;
        io.emit('log', '📴 Livestream kết thúc. Tự động kết nối lại khi stream mới bắt đầu...');
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => connectToTikTok(uniqueId), 30000);
    });

    tiktokConnection.on('error', err => {
        console.error('🔴 Lỗi:', err);
    });
}

io.on('connection', (socket) => {
    console.log('Client connected');

    if (isConnected && currentUniqueId) {
        socket.emit('connected', { uniqueId: currentUniqueId });
    } else if (currentUniqueId) {
        socket.emit('log', `Đang kết nối lại tới @${currentUniqueId}...`);
    }

    socket.on('setUniqueId', (data) => {
        const uniqueId = typeof data === 'string' ? data : data.uniqueId;
        console.log(`Kết nối tới: @${uniqueId}`);
        connectToTikTok(uniqueId);
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Server chạy tại http://localhost:${PORT}`);
});
