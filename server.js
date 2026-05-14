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
    
    // Nếu đang trong quá trình kết nối thì bỏ qua yêu cầu mới
    if (isConnecting) {
        console.log("Already attempting to connect, please wait...");
        return;
    }

    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    // Dọn dẹp kết nối cũ một cách triệt để
    if (tiktokConnection) {
        try {
            tiktokConnection.removeAllListeners();
            tiktokConnection.disconnect();
        } catch(e) {
            console.error("Error during disconnect:", e);
        }
        tiktokConnection = null;
    }

    isConnected = false;
    isConnecting = true;
    currentUniqueId = uniqueId;
    
    console.log(`🚀 Đang kết nối tới TikTok: @${uniqueId}`);
    io.emit('log', `Đang kết nối tới @${uniqueId}...`);

    tiktokConnection = new WebcastPushConnection(uniqueId);

    tiktokConnection.connect().then(state => {
        console.info(`✅ Đã kết nối thành công: ${state.roomId}`);
        isConnected = true;
        isConnecting = false;
        io.emit('connected', { roomId: state.roomId, uniqueId });
        io.emit('log', `Kết nối thành công tới phòng ${state.roomId}`);
    }).catch(err => {
        console.error('❌ Kết nối thất bại:', err.message);
        isConnected = false;
        isConnecting = false;
        
        let retryTime = 15000; // Đợi 15 giây trước khi thử lại để tránh bị TikTok chặn (spam)
        io.emit('log', `Kết nối thất bại (${err.message}). Thử lại sau ${retryTime/1000} giây...`);
        
        reconnectTimer = setTimeout(() => connectToTikTok(uniqueId), retryTime);
    });

    // Chỉ gán listener sau khi đã khởi tạo đối tượng mới
    tiktokConnection.on('chat', data => io.emit('tiktok-chat', data));
    tiktokConnection.on('gift', data => io.emit('tiktok-gift', data));
    tiktokConnection.on('like', data => io.emit('tiktok-like', data));
    tiktokConnection.on('follow', data => io.emit('tiktok-follow', data));
    tiktokConnection.on('share', data => io.emit('tiktok-share', data));

    tiktokConnection.on('disconnected', () => {
        if (!isConnected && !isConnecting) return; // Tránh loop nếu đã ngắt kết nối chủ động
        
        console.log('⚠️ TikTok disconnected. Reconnecting in 10s...');
        isConnected = false;
        isConnecting = false;
        io.emit('log', 'Mất kết nối với TikTok. Đang thử lại sau 10 giây...');
        
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => connectToTikTok(uniqueId), 10000);
    });

    tiktokConnection.on('streamEnd', () => {
        console.log('📴 Stream ended. Waiting for new stream...');
        isConnected = false;
        isConnecting = false;
        io.emit('log', 'Livestream đã kết thúc. Sẽ tự động kết nối lại khi stream mới bắt đầu...');
        
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => connectToTikTok(uniqueId), 30000); // Đợi lâu hơn khi stream kết thúc
    });

    tiktokConnection.on('error', err => {
        console.error('🔴 TikTok error:', err);
        // Không gọi connectToTikTok trực tiếp ở đây để tránh loop vô tận khi lỗi liên tục
    });
}

io.on('connection', (socket) => {
    console.log('Client connected');

    // Immediately notify the new client if already connected
    if (isConnected && currentUniqueId) {
        socket.emit('connected', { uniqueId: currentUniqueId });
    } else if (currentUniqueId) {
        // Was connected before, let the game know it's reconnecting
        socket.emit('log', `Đang kết nối lại tới @${currentUniqueId}...`);
    }

    socket.on('setUniqueId', (uniqueId) => {
        console.log(`New TikTok ID: ${uniqueId}`);
        connectToTikTok(uniqueId);
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
