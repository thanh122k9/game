const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const socket = io();

// Config & Settings
let settings = JSON.parse(localStorage.getItem('gameSettings')) || {
    commands: { join: '!choi', attack: 'f', left: 'a', right: 'd', jump: 'w' },
    damage: { punch: 1, sword: 2, pistol: 5, rifle: 10, sniper: 20 },
    dropInterval: 30
};

const colorMap = {
    'đỏ': '#ff4444',
    'xanh': '#00f2ff',
    'lá': '#44ff44',
    'vàng': '#ffff44',
    'hồng': '#ff44ff',
    'cam': '#ff8844',
    'tím': '#8844ff',
    'trắng': '#ffffff',
    'đen': '#555555',
    'nâu': '#8B4513'
};

const bc = new BroadcastChannel('game_sync');
bc.onmessage = (msg) => {
    if (msg.data.type === 'UPDATE_SETTINGS') {
        settings = msg.data.settings;
        addLog('Đã cập nhật cài đặt!', '#00f2ff');
        lastDropTime = Date.now();
    }
};

// Set canvas size
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// Game Objects
let players = {};
let particles = [];
let projectiles = [];
let supplyDrops = [];
let gameStatus = 'waiting';
let lastDropTime = Date.now();
let screenShake = 0;

// Player Class
class Stickman {
    constructor(x, y, nickname, color) {
        this.x = x; this.y = y; this.nickname = nickname;
        this.color = color || '#00f2ff';
        this.width = 50; this.height = 90;
        this.velX = 0; this.velY = 0;
        this.speed = 10; this.jumpForce = 17;
        this.gravity = 0.6; this.grounded = false;
        this.facing = 1; this.health = 200;
        this.lastActive = Date.now();
        this.score = 0;
        this.firstLanding = true;

        // Weapon State
        this.weapon = { type: 'punch', ammo: 0, timer: 0 };
        this.isAttacking = false;
        this.attackTimer = 0;

        this.buffTimer = 0;
        
        // Popup Text System
        this.popupText = '';
        this.popupTimer = 0;
        this.popupColor = '#fff';

        // Death State
        this.isDead = false;
        this.deathTimer = 0;
        this.deathOpacity = 1.0;
    }

    draw() {
        // Buff Aura
        if (this.buffTimer > 0 && !this.isDead) {
            ctx.shadowBlur = 20;
            ctx.shadowColor = this.damageMult > 1 ? '#ff4444' : '#00ff88';
        }

        ctx.save();
        if (this.isDead) {
            ctx.globalAlpha = this.deathOpacity;
        }

        this.drawBody(this.x, this.y, this.color, this.facing, this.isAttacking);
        ctx.shadowBlur = 0;
        
        // Nickname
        if (!this.isDead) {
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 13px Poppins';
            ctx.textAlign = 'center';
            ctx.fillText(this.nickname, this.x + this.width / 2, this.y - 55);
        }
        
        // Buff / Weapon info
        if (this.buffTimer > 0) {
            ctx.fillStyle = '#ffff00';
            ctx.font = 'bold 10px Poppins';
            ctx.fillText(this.buffText, this.x + this.width / 2, this.y - 85);
            this.buffTimer--;
        }

        if (this.weapon.type !== 'punch' && !this.isDead) {
            ctx.fillStyle = '#00f2ff';
            ctx.font = '11px Orbitron';
            let label = this.weapon.name || this.weapon.type.toUpperCase();
            let info = this.weapon.type === 'sword' ? `${Math.ceil(this.weapon.timer/60)}s` : `${this.weapon.ammo}v`;
            ctx.fillText(`${label} [${info}]`, this.x + this.width / 2, this.y - 70);
        }

        if (!this.isDead) {
            ctx.fillStyle = 'rgba(255,255,255,0.2)';
            ctx.fillRect(this.x - 10, this.y - 45, 70, 6);
            ctx.fillStyle = '#ff4444';
            ctx.fillRect(this.x - 10, this.y - 45, (this.health / 200) * 70, 6);
        }

        // Floating Popup Text
        if (this.popupTimer > 0) {
            ctx.save();
            ctx.globalAlpha = Math.min(1, this.popupTimer / 20);
            ctx.fillStyle = this.popupColor;
            ctx.font = 'bold 16px Orbitron';
            ctx.shadowBlur = 10;
            ctx.shadowColor = this.popupColor;
            let yOffset = -100 - (60 - this.popupTimer) * 0.5;
            ctx.fillText(this.popupText, this.x + this.width / 2, this.y + yOffset);
            ctx.restore();
            this.popupTimer--;
        }
        ctx.restore();
    }

    drawBody(x, y, color, facing, attacking) {
        ctx.save();
        let breathe = (Math.abs(this.velX) < 0.1 && this.grounded && !this.isDead) ? Math.sin(Date.now() / 300) * 3 : 0;
        ctx.translate(x + this.width / 2, y + this.height / 2 + breathe);
        
        if (this.isDead) {
            ctx.rotate(Math.PI / 2 * this.facing); // Ngã sang một bên
            ctx.translate(0, 20); // Điều chỉnh vị trí khi nằm
        }

        ctx.scale(facing, 1);
        ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.lineCap = 'round';
        ctx.shadowBlur = 15; ctx.shadowColor = color;

        // Proportions
        ctx.beginPath(); ctx.arc(0, -35 - breathe * 0.5, 12, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, -23 - breathe * 0.3); ctx.lineTo(0, 10); ctx.stroke();

        let armAngle = attacking ? 1.2 : (Math.abs(this.velX) > 0.1 ? Math.sin(Date.now() / 100) * 0.5 : 0.2);
        ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(25, armAngle * 25);
        ctx.moveTo(0, -15); ctx.lineTo(-15, 10); ctx.stroke();

        if (this.weapon.type !== 'punch') {
            this.drawWeapon(20, - armAngle * 5, this.weapon.type);
        }

        let legCycle = Date.now() / 100;
        let legL = Math.abs(this.velX) > 0.1 ? Math.sin(legCycle) * 20 : 5;
        let legR = Math.abs(this.velX) > 0.1 ? Math.sin(legCycle + Math.PI) * 20 : -5;
        ctx.beginPath(); ctx.moveTo(0, 10); ctx.lineTo(legL, 40);
        ctx.moveTo(0, 10); ctx.lineTo(legR, 40); ctx.stroke();
        ctx.restore();
    }

    drawWeapon(x, y, type) {
        ctx.save();
        ctx.translate(x, y);
        ctx.strokeStyle = '#ffff00';
        ctx.fillStyle = '#ffff00';
        ctx.lineWidth = 3;

        if (type === 'sword') {
            ctx.beginPath();
            ctx.moveTo(0, 0); ctx.lineTo(30, -30); // Lưỡi kiếm
            ctx.stroke();
            ctx.lineWidth = 5;
            ctx.beginPath(); ctx.moveTo(-2, 2); ctx.lineTo(8, -8); // Chuôi
            ctx.stroke();
        } else if (type === 'pistol') {
            ctx.fillRect(0, 0, 15, 6); // Thân súng
            ctx.fillRect(0, 5, 5, 8);  // Tay cầm
        } else if (type === 'rifle') {
            ctx.fillRect(0, 0, 30, 7); // Thân súng
            ctx.fillRect(0, 5, 6, 10); // Tay cầm
            ctx.fillRect(-5, 0, 8, 12); // Báng súng
        } else if (type === 'sniper') {
            ctx.fillRect(-5, 0, 45, 6); // Thân súng dài
            ctx.fillRect(0, 5, 6, 10);  // Tay cầm
            ctx.fillRect(-10, 0, 10, 15); // Báng súng
            ctx.fillRect(10, -5, 12, 4); // Ống ngắm
        }
        ctx.restore();
    }

    update() {
        this.velY += this.gravity; this.y += this.velY;
        const groundY = canvas.height - 30;
        if (this.y + this.height > groundY) {
            this.y = groundY - this.height; this.velY = 0;
            if (!this.grounded && this.firstLanding) { createParticles(this.x + 25, this.y + 90, this.color, 30); this.firstLanding = false; }
            this.grounded = true;
        } else { this.grounded = false; }
        this.x += this.velX; this.velX *= 0.85;
        if (this.x < 0) this.x = 0; if (this.x > canvas.width - this.width) this.x = canvas.width - this.width;
        
        if (this.isAttacking) { this.attackTimer--; if (this.attackTimer <= 0) this.isAttacking = false; }
        if (this.weapon.type === 'sword' && this.weapon.timer > 0) {
            this.weapon.timer--; if (this.weapon.timer <= 0) this.weapon.type = 'punch';
        }
        
        for (let i = supplyDrops.length - 1; i >= 0; i--) {
            const drop = supplyDrops[i];
            const d = Math.hypot(this.x + 25 - drop.x, this.y + 45 - drop.y);
            if (d < 60) {
                this.weapon = drop.weapon;
                this.showPopup(this.weapon.name, '#ffff00');
                addLog(`${this.nickname} nhặt ${this.weapon.name}`, '#ffff00');
                supplyDrops.splice(i, 1);
                createParticles(drop.x, drop.y, '#ffff00', 20);
                break; // One pick up per update
            }
        }

        if (this.health <= 0 && !this.isDead) {
            this.isDead = true;
            this.deathTimer = 60; // 1 second
            addLog(`${this.nickname} đã gục ngã!`, '#ff4444');
            createParticles(this.x + 25, this.y + 45, '#ff4444', 40);
            updateLeaderboard();
        }

        if (this.isDead) {
            this.deathTimer--;
            this.deathOpacity = Math.max(0, this.deathTimer / 60);
            if (this.deathTimer <= 0) {
                delete players[this.nickname];
                updateLeaderboard();
            }
        }
    }

    moveLeft() {
        if (this.isDead) return;
        this.velX = -this.speed;
        this.facing = -1;
    }

    moveRight() {
        if (this.isDead) return;
        this.velX = this.speed;
        this.facing = 1;
    }

    jump() {
        if (this.isDead) return;
        if (this.grounded) {
            this.velY = -this.jumpForce;
            this.grounded = false;
            createParticles(this.x + 25, this.y + 90, this.color, 15);
        }
    }

    attack() {
        if (this.isDead) return;
        this.isAttacking = true; this.attackTimer = 10;
        if (this.weapon.type === 'punch' || this.weapon.type === 'sword') {
            const dmg = (this.weapon.type === 'punch' ? settings.damage.punch : settings.damage.sword) * this.damageMult;
            const range = this.weapon.type === 'sword' ? 100 : 70;
            Object.values(players).forEach(other => {
                if (other === this) return;
                if (Math.hypot(this.x - other.x, this.y - other.y) < range) {
                    const finalDmg = Math.max(1, dmg - other.armor);
                    other.health -= finalDmg; other.velX = this.facing * 6;
                    createParticles(other.x + 25, other.y + 45, '#ff4444', 10);
                    this.score += finalDmg; updateLeaderboard();
                    if (finalDmg > 15) screenShake = 5;
                }
            });
        } else {
            if (this.weapon.ammo > 0) {
                const dmg = settings.damage[this.weapon.type] * this.damageMult;
                projectiles.push(new Projectile(this.x + 25, this.y + 35, this.facing, dmg, this.nickname));
                this.weapon.ammo--; if (this.weapon.ammo <= 0) this.weapon.type = 'punch';
                createParticles(this.x + 25 + this.facing * 35, this.y + 35, '#fff', 8);
                screenShake = Math.max(screenShake, 3);
            }
        }
    }

    applyBuff(type) {
        this.buffTimer = 300;
        switch(type) {
            case 'damage': this.damageMult += 0.5; this.buffText = 'CÔNG +50%!'; break;
            case 'heal': this.health = Math.min(200, this.health + 80); this.buffText = 'HỒI MÁU +80!'; break;
            case 'armor': this.armor += 5; this.buffText = 'GIÁP +5!'; break;
        }
        this.score += 50; updateLeaderboard();
        this.showPopup(this.buffText, '#00ff88');
    }

    showPopup(text, color) {
        this.popupText = text;
        this.popupColor = color || '#fff';
        this.popupTimer = 60; // 1 second
    }
}

class Projectile {
    constructor(x, y, dir, dmg, owner) {
        this.x = x; this.y = y; this.velX = dir * 20; this.dmg = dmg; this.owner = owner;
        this.life = 100;
    }
    update() {
        this.x += this.velX; this.life--;
        Object.values(players).forEach(p => {
            if (p.nickname === this.owner) return;
            if (Math.hypot(this.x - (p.x + 25), this.y - (p.y + 45)) < 40) {
                const finalDmg = Math.max(1, this.dmg - p.armor);
                p.health -= finalDmg; createParticles(this.x, this.y, '#ff4444', 15);
                this.life = 0; if (players[this.owner]) players[this.owner].score += finalDmg;
                updateLeaderboard();
                if (finalDmg > 15) screenShake = 5;
            }
        });
    }
    draw() { ctx.fillStyle = '#ffff00'; ctx.beginPath(); ctx.arc(this.x, this.y, 4, 0, Math.PI * 2); ctx.fill(); }
}

class SupplyDrop {
    constructor() {
        this.x = Math.random() * (canvas.width - 100) + 50;
        this.y = -50; this.speed = 1.0;
        const r = Math.random();
        if (r < 0.25) this.weapon = { type: 'sword', timer: 1800, ammo: 0, name: 'Kiếm' };
        else if (r < 0.5) this.weapon = { type: 'pistol', ammo: 12, timer: 0, name: 'Súng Lục' };
        else if (r < 0.8) this.weapon = { type: 'rifle', ammo: 30, timer: 0, name: 'Súng Trường' };
        else this.weapon = { type: 'sniper', ammo: 10, timer: 0, name: 'Súng Ngắm' };
        
        this.landed = false;
        this.life = 1800; // 30 seconds * 60 fps
    }
    update() { 
        if (this.y < canvas.height - 80) {
            this.y += this.speed; 
        } else {
            this.landed = true;
            this.life--;
        }
    }
    draw() {
        ctx.save();
        if (this.landed && this.life < 300) {
            ctx.globalAlpha = Math.sin(Date.now() / 50) * 0.5 + 0.5;
        }
        
        const x = this.x - 20;
        const y = this.y - 20;
        const w = 40;
        const h = 40;

        // Thân dưới (Xanh dương)
        ctx.fillStyle = '#1a3c5e';
        ctx.fillRect(x, y + h/2, w, h/2);
        
        // Nắp trên (Đỏ)
        ctx.fillStyle = '#b22222';
        ctx.fillRect(x, y, w, h/2);

        // Viền và dây đai (Vàng/Đen)
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
        
        // Dây đai vàng đặc trưng
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x + w/3, y); ctx.lineTo(x + w/3, y + h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + 2*w/3, y); ctx.lineTo(x + 2*w/3, y + h); ctx.stroke();
        
        if (this.y < canvas.height - 100) {
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(this.x, y - 40);
            ctx.lineTo(x + w, y); ctx.stroke();
            ctx.beginPath(); ctx.arc(this.x, y - 40, 20, Math.PI, 0); ctx.stroke();
        }
        ctx.restore();
    }
}

class Particle {
    constructor(x, y, color) {
        this.x = x; this.y = y; this.color = color;
        this.size = Math.random() * 4 + 1;
        this.velX = (Math.random() - 0.5) * 10; this.velY = (Math.random() - 0.5) * 10;
        this.life = 1.0; this.decay = 0.03;
    }
    update() { this.x += this.velX; this.y += this.velY; this.life -= this.decay; }
    draw() { ctx.fillStyle = this.color; ctx.globalAlpha = this.life; ctx.beginPath(); ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1.0; }
}

function createParticles(x, y, color, count) { for (let i = 0; i < count; i++) particles.push(new Particle(x, y, color)); }

function updateLeaderboard() {
    const list = document.getElementById('leaderboard-list');
    if (!list) return;
    const sorted = Object.values(players).sort((a, b) => b.score - a.score).slice(0, 5);
    list.innerHTML = sorted.map((p, i) => `
        <div class="leaderboard-item">
            <span>${i+1}. ${p.nickname}</span>
            <span style="color: ${p.color}">${Math.floor(p.score)}</span>
        </div>
    `).join('');
}

function addLog(msg, color = '#fff') {
    const log = document.getElementById('event-log');
    if (!log) return;
    const entry = document.createElement('div');
    entry.className = 'log-entry'; entry.style.borderLeft = `3px solid ${color}`; entry.textContent = msg;
    log.appendChild(entry);
    if (log.children.length > 8) log.removeChild(log.firstChild);
}

socket.on('connected', () => {
    addLog('TikTok Đã Kết Nối!', '#00f2ff');
    gameStatus = 'playing'; // Start game
});
socket.on('log', (msg) => { addLog(msg, '#ff8800'); });

socket.on('tiktok-chat', (data) => {
    const nick = data.nickname, msg = data.comment.toLowerCase().trim();

    // Color change or Join with color
    if (colorMap[msg]) {
        const selectedColor = colorMap[msg];
        if (!players[nick]) {
            players[nick] = new Stickman(Math.random() * (canvas.width - 100) + 50, -100, nick, selectedColor);
            addLog(`${nick} tham gia màu ${msg}!`, selectedColor);
        } else {
            players[nick].color = selectedColor;
            createParticles(players[nick].x + 25, players[nick].y + 45, selectedColor, 20);
        }
        gameStatus = 'playing';
        return;
    }

    const p = players[nick];
    if (p) {
        p.lastActive = Date.now();
        let cmdFound = false;
        if (msg === settings.commands.left) { p.moveLeft(); cmdFound = true; }
        else if (msg === settings.commands.right) { p.moveRight(); cmdFound = true; }
        if (msg.includes(settings.commands.jump)) { p.jump(); cmdFound = true; }
        if (msg.includes(settings.commands.attack)) { p.attack(); cmdFound = true; }
    }
});

socket.on('tiktok-like', (data) => { if (players[data.nickname]) players[data.nickname].attack(); });

socket.on('tiktok-gift', (data) => {
    const p = players[data.nickname];
    if (p && gameStatus === 'playing') {
        const types = ['damage', 'heal', 'armor'];
        const type = types[Math.floor(Math.random() * types.length)];
        p.applyBuff(type);
        addLog(`${data.nickname} nhận quà & Buff!`, '#ffff00');
        createParticles(p.x + 25, p.y + 45, '#ffff00', 40);
    }
});

function animate() {
    ctx.save();
    if (screenShake > 0) {
        ctx.translate(Math.random() * screenShake - screenShake/2, Math.random() * screenShake - screenShake/2);
        screenShake *= 0.9;
        if (screenShake < 0.1) screenShake = 0;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackground();
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'; 
    ctx.fillRect(0, canvas.height - 30, canvas.width, 30);

    if (gameStatus === 'playing') {
        if (Date.now() - lastDropTime > settings.dropInterval * 1000) {
            supplyDrops.push(new SupplyDrop());
            lastDropTime = Date.now();
            addLog('THÍNH RƠI!', '#ff8800');
        }
        const pList = Object.values(players);
        pList.forEach(p => { p.update(); p.draw(); if (Date.now() - p.lastActive > 300000) { delete players[p.nickname]; updateLeaderboard(); } });
        for (let i = supplyDrops.length - 1; i >= 0; i--) {
            supplyDrops[i].update();
            supplyDrops[i].draw();
            if (supplyDrops[i].life <= 0) {
                supplyDrops.splice(i, 1);
            }
        }
        projectiles.forEach((proj, idx) => {
            proj.update(); proj.draw();
            if (proj.life <= 0) projectiles.splice(idx, 1);
        });
        for (let i = particles.length - 1; i >= 0; i--) {
            particles[i].update(); particles[i].draw();
            if (particles[i].life <= 0) particles.splice(i, 1);
        }
    } else {
        ctx.fillStyle = '#fff'; ctx.font = '30px Orbitron'; ctx.textAlign = 'center';
        ctx.fillText('ĐANG CHỜ KẾT NỐI TIKTOK', canvas.width / 2, canvas.height / 2);
    }
    ctx.restore();
    requestAnimationFrame(animate);
}
function drawBackground() {
    ctx.strokeStyle = 'rgba(0, 242, 255, 0.05)';
    ctx.lineWidth = 1;
    const size = 50;
    const offset = (Date.now() / 50) % size;
    
    for (let x = -offset; x < canvas.width; x += size) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = -offset; y < canvas.height; y += size) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }
    
    // Vignette
    const grad = ctx.createRadialGradient(canvas.width/2, canvas.height/2, 0, canvas.width/2, canvas.height/2, canvas.width);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

animate();
